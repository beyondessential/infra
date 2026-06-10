#!/bin/bash

set -euo pipefail

export KOPIA_CHECK_FOR_UPDATES=false

# Back up the active postgres cluster as a kopia snapshot.
#
# The @postgres btrfs subvolume is snapshotted (writable) between
# pg_backup_start and pg_backup_stop. pg_backup_stop's backup_label and
# tablespace_map are written into the snapshot's data dir before kopia
# reads it, producing a complete, restorable base backup in a single
# kopia snapshot rooted at the cluster's data dir (matching the ext4
# script's "one cluster" layout).

POSTGRES_DIR="/var/lib/postgresql"
HOSTNAME=$(hostname)

PGDATA=$(readlink -f "$POSTGRES_DIR/current")
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "ERROR: $PGDATA is not a postgres data dir" >&2
  exit 1
fi
PG_VERSION=$(basename "$(dirname "$PGDATA")")
PG_CLUSTER=$(basename "$PGDATA")

FSDEV="/dev/disk/by-uuid/$(findmnt "$POSTGRES_DIR" -o UUID -n)"

KOPIA_UID=$(id -u kopia)
KOPIA_GID=$(id -g kopia)
POSTGRES_UID=$(id -u postgres)
POSTGRES_GID=$(id -g postgres)
MAPPING="u:$POSTGRES_UID:$KOPIA_UID:1 g:$POSTGRES_GID:$KOPIA_GID:1"

TOPLEVEL_MOUNT=""
SNAPSHOT_PATH=""
KOPIA_MOUNT=""
PSQL_DIR=""
PSQL_PID=""
PSQL_FD_OPEN=false

cleanup() {
  if [ -n "$KOPIA_MOUNT" ] && mountpoint -q "$KOPIA_MOUNT" 2>/dev/null; then
    umount "$KOPIA_MOUNT" || true
  fi
  if [ -n "$KOPIA_MOUNT" ] && [ -d "$KOPIA_MOUNT" ]; then
    rmdir "$KOPIA_MOUNT" || true
  fi
  # Closing the psql session ends pg_backup mode if still active.
  if $PSQL_FD_OPEN; then
    exec 9>&- || true
    PSQL_FD_OPEN=false
  fi
  if [ -n "$PSQL_PID" ]; then
    wait "$PSQL_PID" 2>/dev/null || true
    PSQL_PID=""
  fi
  if [ -n "$PSQL_DIR" ] && [ -d "$PSQL_DIR" ]; then
    rm -rf "$PSQL_DIR" || true
  fi
  if [ -n "$SNAPSHOT_PATH" ] && [ -d "$SNAPSHOT_PATH" ]; then
    btrfs subvolume delete "$SNAPSHOT_PATH" || true
  fi
  if [ -n "$TOPLEVEL_MOUNT" ] && mountpoint -q "$TOPLEVEL_MOUNT" 2>/dev/null; then
    umount "$TOPLEVEL_MOUNT" || true
  fi
  if [ -n "$TOPLEVEL_MOUNT" ] && [ -d "$TOPLEVEL_MOUNT" ]; then
    rmdir "$TOPLEVEL_MOUNT" || true
  fi
}
trap cleanup ERR EXIT

if ! sudo -u postgres pg_isready -q; then
  echo "ERROR: PostgreSQL is not running" >&2
  exit 1
fi

TOPLEVEL_MOUNT="/mnt/btrfs-toplevel-kopia.$$"
SNAPSHOT_NAME="@postgres-kopia-$$"
SNAPSHOT_SUBVOL="$SNAPSHOT_NAME"

mkdir -p "$TOPLEVEL_MOUNT"
mount -o subvolid=5 "$FSDEV" "$TOPLEVEL_MOUNT"
SNAPSHOT_PATH="$TOPLEVEL_MOUNT/$SNAPSHOT_NAME"
SNAPSHOT_DATADIR="$SNAPSHOT_PATH/$PG_VERSION/$PG_CLUSTER"

# Drive a long-running psql session held open by fd 9 on a fifo so the
# pg_backup_start / pg_backup_stop pair runs in one session (otherwise
# pg_backup_stop sees no active backup and errors out). Markers are synced
# via touch on a shared directory to avoid stdio buffering issues.
PSQL_DIR=$(mktemp -d --tmpdir kopia-psql.XXXXXX)
chmod 0777 "$PSQL_DIR"
PSQL_FIFO="$PSQL_DIR/in"
mkfifo -m 0666 "$PSQL_FIFO"

sudo -u postgres psql -X -v ON_ERROR_STOP=on < "$PSQL_FIFO" &
PSQL_PID=$!
exec 9> "$PSQL_FIFO"
PSQL_FD_OPEN=true

# Timeout is per psql block, in tenths of a second. pg_backup_start with
# fast=false can take up to checkpoint_completion_target * checkpoint_timeout
# (default ~4.5 min); wait_for_archive=true on pg_backup_stop can also be
# slow if WAL archiving is backed up. 10 minutes gives generous headroom.
psql_run() {
  local marker="$PSQL_DIR/m.$RANDOM.$RANDOM"
  printf '%s\n\\! touch %s\n' "$1" "$marker" >&9
  local i
  for i in $(seq 1 6000); do
    if [ -e "$marker" ]; then
      rm -f "$marker"
      return 0
    fi
    if ! kill -0 "$PSQL_PID" 2>/dev/null; then
      echo "ERROR: psql session ended unexpectedly" >&2
      return 1
    fi
    sleep 0.1
  done
  echo "ERROR: timeout waiting for psql command: $1" >&2
  return 1
}

echo "Starting PostgreSQL backup mode..."
psql_run "SELECT pg_backup_start(label => 'kopia_backup', fast => false);"

echo "Creating btrfs snapshot at $SNAPSHOT_PATH"
btrfs subvolume snapshot "$POSTGRES_DIR" "$SNAPSHOT_PATH"

# pg_backup_stop returns the lsn, the backup_label contents (labelfile), and
# the tablespace_map contents (spcmapfile). Write the latter two straight
# into the snapshot's data dir; psql does the file write itself via `\g`,
# running as the postgres user, into a postgres-owned directory.
echo "Stopping PostgreSQL backup mode (writing backup metadata into snapshot)..."
psql_run "\\pset format unaligned
\\pset tuples_only on
\\pset recordsep ''
SELECT lsn::text AS lsn, labelfile, spcmapfile FROM pg_backup_stop(wait_for_archive => true) \\gset
SELECT :'labelfile' \\g $SNAPSHOT_DATADIR/backup_label
SELECT :'spcmapfile' \\g $SNAPSHOT_DATADIR/tablespace_map"

printf '\\q\n' >&9
exec 9>&-
PSQL_FD_OPEN=false
wait "$PSQL_PID" || true
PSQL_PID=""

# Postgres expects no tablespace_map file when the cluster has no extra
# tablespaces (rather than an empty one).
if [ ! -s "$SNAPSHOT_DATADIR/tablespace_map" ]; then
  rm -f "$SNAPSHOT_DATADIR/tablespace_map"
fi

if [ ! -s "$SNAPSHOT_DATADIR/backup_label" ]; then
  echo "ERROR: backup_label was not written into the snapshot" >&2
  exit 1
fi

KOPIA_MOUNT="/var/lib/kopia/mnt-postgres-$$"
mkdir -p "$KOPIA_MOUNT"

echo "Mount snapshot for kopia at $KOPIA_MOUNT"
mount "$FSDEV" "$KOPIA_MOUNT" -o "subvol=$SNAPSHOT_SUBVOL,X-mount.idmap=$MAPPING"

KOPIA_SOURCE="$KOPIA_MOUNT/$PG_VERSION/$PG_CLUSTER"

echo "Backing up $KOPIA_SOURCE"

sudo -u kopia \
  kopia policy set \
  --add-ignore="postmaster.pid" \
  --add-ignore="*.log" \
  --add-ignore="pg_stat_tmp/*" \
  --add-ignore="lost+found" \
  "$KOPIA_SOURCE"

sudo -u kopia \
  kopia snapshot create \
  --tags area:postgres \
  --tags type:btrfs \
  --description="$HOSTNAME Postgres" \
  "$KOPIA_SOURCE"

echo "Backup complete"

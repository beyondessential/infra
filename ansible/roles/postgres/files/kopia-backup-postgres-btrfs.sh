#!/bin/bash

set -euo pipefail

export KOPIA_CHECK_FOR_UPDATES=false

# Backs up postgres using a fresh, ephemeral btrfs snapshot created for
# this run and removed after upload.

POSTGRES_DIR="/var/lib/postgresql"
HOSTNAME=$(hostname)

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
  echo "ERROR: PostgreSQL is not running"
  exit 1
fi

TOPLEVEL_MOUNT="/mnt/btrfs-toplevel-kopia.$$"
SNAPSHOT_NAME="@postgres-kopia-$$"
SNAPSHOT_SUBVOL="$SNAPSHOT_NAME"

mkdir -p "$TOPLEVEL_MOUNT"
mount -o subvolid=5 "$FSDEV" "$TOPLEVEL_MOUNT"
SNAPSHOT_PATH="$TOPLEVEL_MOUNT/$SNAPSHOT_NAME"

# Drive a long-running psql session held open by fd 9 on a fifo so that the
# pg_backup_start / pg_backup_stop pair runs in a single session (otherwise
# pg_backup_stop sees no active backup and errors out). Markers are synced via
# touch on a shared directory to avoid stdio buffering issues.
PSQL_DIR=$(mktemp -d --tmpdir kopia-psql.XXXXXX)
chmod 0777 "$PSQL_DIR"
PSQL_FIFO="$PSQL_DIR/in"
mkfifo -m 0666 "$PSQL_FIFO"

sudo -u postgres psql -X -v ON_ERROR_STOP=on < "$PSQL_FIFO" &
PSQL_PID=$!
exec 9> "$PSQL_FIFO"
PSQL_FD_OPEN=true

psql_run() {
  local marker="$PSQL_DIR/m.$RANDOM.$RANDOM"
  printf '%s\n\\! touch %s\n' "$1" "$marker" >&9
  local i
  for i in $(seq 1 600); do
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
btrfs subvolume snapshot -r "$POSTGRES_DIR" "$SNAPSHOT_PATH"

echo "Stopping PostgreSQL backup mode..."
psql_run "SELECT pg_backup_stop(wait_for_archive => false);"

printf '\\q\n' >&9
exec 9>&-
PSQL_FD_OPEN=false
wait "$PSQL_PID" || true
PSQL_PID=""

KOPIA_MOUNT="/var/lib/kopia/mnt-postgres-$$"
mkdir -p "$KOPIA_MOUNT"

echo "Mount snapshot as readable by kopia at $KOPIA_MOUNT"
mount "$FSDEV" "$KOPIA_MOUNT" -o "subvol=$SNAPSHOT_SUBVOL,X-mount.idmap=$MAPPING"

echo "Backing up snapshot at $KOPIA_MOUNT"

sudo -u kopia \
  kopia policy set \
  --add-ignore="postmaster.pid" \
  --add-ignore="*.log" \
  --add-ignore="pg_stat_tmp/*" \
  --add-ignore="lost+found" \
  "$KOPIA_MOUNT"

sudo -u kopia \
  kopia snapshot create \
  --tags area:postgres \
  --tags type:btrfs \
  --description="$HOSTNAME Postgres" \
  "$KOPIA_MOUNT"

echo "Backup complete"

#!/bin/bash

set -euo pipefail

export KOPIA_CHECK_FOR_UPDATES=false

# Back up the active postgres cluster as a kopia snapshot.
#
# An atomic, read-only btrfs snapshot of the @postgres subvolume is taken and
# handed to kopia. The snapshot includes pg_wal, so it is self-contained: on
# restore postgres treats it as a crash and replays WAL to a consistent state
# (PostgreSQL's documented filesystem-snapshot recovery).
#
# We deliberately do NOT use pg_backup_start/pg_backup_stop or write a
# backup_label. Doing so turns the restore into a base-backup restore that
# must replay WAL up to the pg_backup_stop record -- which a snapshot taken
# before pg_backup_stop does not contain. Recovery then fails with "WAL ends
# before end of online backup" and has to be forced with pg_resetwal, which
# skips WAL replay and leaves torn pages (surfacing mostly as index
# corruption, and worse, cross-table inconsistency). A plain atomic snapshot
# restores cleanly via crash recovery instead. The CHECKPOINT just before the
# snapshot only bounds how much WAL recovery has to replay.

POSTGRES_DIR="/var/lib/postgresql"
HOSTNAME=$(hostname)

# Stable path the ephemeral snapshot is mounted at for kopia to read. It must
# NOT vary between runs: kopia tracks snapshot history, incremental dedup, and
# retention per source path (user@host:path), so a per-run path would make
# every backup a brand-new source with a single snapshot and no history. The
# $PG_VERSION/$PG_CLUSTER suffix below changes only across a major-version
# upgrade, which is a genuinely new cluster and an acceptable history boundary.
KOPIA_MOUNT_STABLE="/var/lib/kopia/mnt-postgres"

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

cleanup() {
  if [ -n "$KOPIA_MOUNT" ] && mountpoint -q "$KOPIA_MOUNT" 2>/dev/null; then
    umount "$KOPIA_MOUNT" || true
  fi
  if [ -n "$KOPIA_MOUNT" ] && [ -d "$KOPIA_MOUNT" ]; then
    rmdir "$KOPIA_MOUNT" || true
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

# Reap leftovers from a previously crashed run. A hard reboot mid-backup skips
# the EXIT trap, so without this the stable kopia mount, per-PID toplevel
# mounts, and ephemeral @postgres-kopia-* snapshot subvolumes accumulate:
# mounts pin the device and orphaned subvolumes consume space indefinitely.
reap_stale() {
  if mountpoint -q "$KOPIA_MOUNT_STABLE" 2>/dev/null; then
    umount "$KOPIA_MOUNT_STABLE" || true
  fi
  local stale
  for stale in /mnt/btrfs-toplevel-kopia.*; do
    [ -d "$stale" ] || continue
    if mountpoint -q "$stale" 2>/dev/null; then
      umount "$stale" || true
    fi
    rmdir "$stale" 2>/dev/null || true
  done
  # Delete orphaned ephemeral snapshot subvolumes via a fresh top-level mount.
  # The "-kopia-" infix guarantees the glob never matches the live @postgres
  # subvolume, only our own ephemeral ones.
  local reap_mount="/mnt/btrfs-toplevel-kopia-reap.$$"
  mkdir -p "$reap_mount"
  if mount -o subvolid=5 "$1" "$reap_mount" 2>/dev/null; then
    local sub
    for sub in "$reap_mount"/@postgres-kopia-*; do
      [ -e "$sub" ] || continue
      btrfs subvolume delete "$sub" || true
    done
    umount "$reap_mount" || true
  fi
  rmdir "$reap_mount" 2>/dev/null || true
}

if ! sudo -u postgres pg_isready -q; then
  echo "ERROR: PostgreSQL is not running" >&2
  exit 1
fi

reap_stale "$FSDEV"

TOPLEVEL_MOUNT="/mnt/btrfs-toplevel-kopia.$$"
SNAPSHOT_NAME="@postgres-kopia-$$"
SNAPSHOT_SUBVOL="$SNAPSHOT_NAME"

mkdir -p "$TOPLEVEL_MOUNT"
mount -o subvolid=5 "$FSDEV" "$TOPLEVEL_MOUNT"
SNAPSHOT_PATH="$TOPLEVEL_MOUNT/$SNAPSHOT_NAME"

# Force a checkpoint immediately before the snapshot to bound how much WAL
# recovery replays on restore. This is an optimisation, not a correctness
# requirement -- the snapshot is crash-consistent regardless -- so a failure
# here must not fail the backup.
echo "Issuing CHECKPOINT..."
sudo -u postgres psql -X -q -c "CHECKPOINT;" \
  || echo "WARNING: CHECKPOINT failed; snapshot is still crash-consistent, recovery may just replay more WAL" >&2

echo "Creating read-only btrfs snapshot at $SNAPSHOT_PATH"
btrfs subvolume snapshot -r "$POSTGRES_DIR" "$SNAPSHOT_PATH"

KOPIA_MOUNT="$KOPIA_MOUNT_STABLE"
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

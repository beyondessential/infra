#!/bin/bash

set -euo pipefail

export KOPIA_CHECK_FOR_UPDATES=false

# Backs up postgres using a btrfs snapshot, either:
# - the latest snapper snapshot (when snapper is configured for postgres), or
# - a fresh snapshot taken by this script and removed after upload (otherwise).

SNAPPER_CONFIG="postgres"
POSTGRES_DIR="/var/lib/postgresql"
HOSTNAME=$(hostname)

USE_SNAPPER=false
if snapper -c "$SNAPPER_CONFIG" list >/dev/null 2>&1; then
  USE_SNAPPER=true
fi

FSDEV="/dev/disk/by-uuid/$(findmnt "$POSTGRES_DIR" -o UUID -n)"

KOPIA_UID=$(id -u kopia)
KOPIA_GID=$(id -g kopia)
POSTGRES_UID=$(id -u postgres)
POSTGRES_GID=$(id -g postgres)
MAPPING="u:$POSTGRES_UID:$KOPIA_UID:1 g:$POSTGRES_GID:$KOPIA_GID:1"

TOPLEVEL_MOUNT=""
MANUAL_SNAPSHOT_PATH=""
IN_BACKUP_MODE=false
KOPIA_MOUNT=""

cleanup() {
  if [ -n "$KOPIA_MOUNT" ] && mountpoint -q "$KOPIA_MOUNT" 2>/dev/null; then
    umount "$KOPIA_MOUNT" || true
  fi
  if [ -n "$KOPIA_MOUNT" ] && [ -d "$KOPIA_MOUNT" ]; then
    rmdir "$KOPIA_MOUNT" || true
  fi
  if $IN_BACKUP_MODE; then
    sudo -u postgres psql -Xqtc "SELECT pg_backup_stop(wait_for_archive => false);" > /dev/null || true
    IN_BACKUP_MODE=false
  fi
  if [ -n "$MANUAL_SNAPSHOT_PATH" ] && [ -d "$MANUAL_SNAPSHOT_PATH" ]; then
    btrfs subvolume delete "$MANUAL_SNAPSHOT_PATH" || true
  fi
  if [ -n "$TOPLEVEL_MOUNT" ] && mountpoint -q "$TOPLEVEL_MOUNT" 2>/dev/null; then
    umount "$TOPLEVEL_MOUNT" || true
  fi
  if [ -n "$TOPLEVEL_MOUNT" ] && [ -d "$TOPLEVEL_MOUNT" ]; then
    rmdir "$TOPLEVEL_MOUNT" || true
  fi
}
trap cleanup ERR EXIT

if $USE_SNAPPER; then
  LATEST_SNAPSHOT=$(snapper -c "$SNAPPER_CONFIG" list --columns number | tail -n1 | xargs)
  if [ -z "$LATEST_SNAPSHOT" ]; then
    echo "ERROR: No snapshots found for configuration '$SNAPPER_CONFIG'"
    exit 1
  fi
  echo "Using snapshot #$LATEST_SNAPSHOT from snapper config '$SNAPPER_CONFIG'"
  SNAPSHOT_SUBVOL="@postgres/.snapshots/$LATEST_SNAPSHOT/snapshot"
  SNAPSHOT_TAG="snapper:$LATEST_SNAPSHOT"
else
  echo "No snapper config for '$SNAPPER_CONFIG'; taking an ephemeral snapshot for this backup"

  if ! sudo -u postgres pg_isready -q; then
    echo "ERROR: PostgreSQL is not running"
    exit 1
  fi

  TOPLEVEL_MOUNT="/mnt/btrfs-toplevel-kopia.$$"
  SNAPSHOT_NAME="@postgres-kopia-$$"
  SNAPSHOT_SUBVOL="$SNAPSHOT_NAME"
  SNAPSHOT_TAG="snapper:none"

  mkdir -p "$TOPLEVEL_MOUNT"
  mount -o subvolid=5 "$FSDEV" "$TOPLEVEL_MOUNT"
  MANUAL_SNAPSHOT_PATH="$TOPLEVEL_MOUNT/$SNAPSHOT_NAME"

  echo "Starting PostgreSQL backup mode..."
  sudo -u postgres psql -Xqtc "SELECT pg_backup_start(label => 'kopia_backup', fast => false);" > /dev/null
  IN_BACKUP_MODE=true

  echo "Creating btrfs snapshot at $MANUAL_SNAPSHOT_PATH"
  btrfs subvolume snapshot -r "$POSTGRES_DIR" "$MANUAL_SNAPSHOT_PATH"

  echo "Stopping PostgreSQL backup mode..."
  sudo -u postgres psql -Xqtc "SELECT pg_backup_stop(wait_for_archive => false);" > /dev/null
  IN_BACKUP_MODE=false
fi

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
  "$KOPIA_MOUNT"

sudo -u kopia \
  kopia snapshot create \
  --tags area:postgres \
  --tags type:btrfs \
  --tags "$SNAPSHOT_TAG" \
  --description="$HOSTNAME Postgres" \
  "$KOPIA_MOUNT"

echo "Backup complete"

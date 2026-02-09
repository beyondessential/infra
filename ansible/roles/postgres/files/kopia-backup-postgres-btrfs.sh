#!/bin/bash

set -euo pipefail

export KOPIA_CHECK_FOR_UPDATES=false

# This script backs up postgres using snapper snapshots
# It requires:
# - snapper configured with a 'postgres' configuration
# - postgres running on btrfs with snapshots enabled

SNAPPER_CONFIG="postgres"
HOSTNAME=$(hostname)

if ! snapper -c "$SNAPPER_CONFIG" list >/dev/null 2>&1; then
  echo "ERROR: snapper configuration '$SNAPPER_CONFIG' does not exist"
  exit 1
fi

LATEST_SNAPSHOT=$(snapper -c "$SNAPPER_CONFIG" list --columns number | tail -n1 | xargs)

if [ -z "$LATEST_SNAPSHOT" ]; then
  echo "ERROR: No snapshots found for configuration '$SNAPPER_CONFIG'"
  exit 1
fi

echo "Using snapshot #$LATEST_SNAPSHOT from snapper config '$SNAPPER_CONFIG'"

SUBVOLUME=$(source "/etc/snapper/configs/$SNAPPER_CONFIG" && echo "$SUBVOLUME")
FSDEV="/dev/disk/by-uuid/$(findmnt "$SUBVOLUME" -o UUID -n)"

SNAPSHOT_SUBVOL="@postgres/.snapshots/$LATEST_SNAPSHOT/snapshot"

KOPIA_UID=$(id -u kopia)
KOPIA_GID=$(id -g kopia)
POSTGRES_UID=$(id -u postgres)
POSTGRES_GID=$(id -g postgres)
MAPPING="u:$POSTGRES_UID:$KOPIA_UID:1 g:$POSTGRES_GID:$KOPIA_GID:1"

echo "Mount snapshot as readable by kopia"
MOUNT="/var/lib/kopia/mnt-postgres-$LATEST_SNAPSHOT"
mkdir -p "$MOUNT"
trap "umount $MOUNT; rmdir $MOUNT" ERR EXIT
mount "$FSDEV" "$MOUNT" -o "subvol=$SNAPSHOT_SUBVOL,X-mount.idmap=$MAPPING"

echo "Backing up snapshot at $MOUNT"

sudo -u kopia \
  kopia snapshot create \
  --tags area:postgres \
  --tags type:btrfs \
  --tags snapper:$LATEST_SNAPSHOT \
  --description="$HOSTNAME Postgres" \
  "$MOUNT"

echo "Backup complete"

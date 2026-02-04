#!/bin/bash

set -euo pipefail

# This script backs up postgres using snapper snapshots
# It requires:
# - snapper configured with a 'postgres' configuration
# - postgres running on btrfs with snapshots enabled

SNAPPER_CONFIG="postgres"
HOSTNAME=$(hostname)

# Check if snapper config exists
if ! snapper -c "$SNAPPER_CONFIG" list >/dev/null 2>&1; then
  echo "ERROR: snapper configuration '$SNAPPER_CONFIG' does not exist"
  exit 1
fi

# Get the most recent snapshot number
LATEST_SNAPSHOT=$(snapper -c "$SNAPPER_CONFIG" list --columns number | tail -n 1)

if [ -z "$LATEST_SNAPSHOT" ]; then
  echo "ERROR: No snapshots found for configuration '$SNAPPER_CONFIG'"
  exit 1
fi

echo "Using snapshot #$LATEST_SNAPSHOT from snapper config '$SNAPPER_CONFIG'"

# Get snapshot path
SNAPSHOT_PATH="/.snapshots/$SNAPPER_CONFIG/$LATEST_SNAPSHOT/snapshot"

if [ ! -d "$SNAPSHOT_PATH" ]; then
  echo "ERROR: Snapshot path does not exist: $SNAPSHOT_PATH"
  exit 1
fi

# Verify it looks like a postgres data directory
if [ ! -f "$SNAPSHOT_PATH/PG_VERSION" ]; then
  echo "ERROR: Snapshot does not contain a valid postgres data directory"
  exit 1
fi

echo "Backing up snapshot at $SNAPSHOT_PATH"

# Take a kopia snapshot
kopia snapshot create \
  --description="$HOSTNAME Postgres (from snapper snapshot #$LATEST_SNAPSHOT)" \
  "$SNAPSHOT_PATH"

echo "Backup complete"

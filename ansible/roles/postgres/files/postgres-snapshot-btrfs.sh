#!/bin/bash

set -euo pipefail

SNAPPER_CONFIG="postgres"

if ! snapper -c "$SNAPPER_CONFIG" list >/dev/null 2>&1; then
  echo "ERROR: snapper configuration '$SNAPPER_CONFIG' does not exist"
  exit 1
fi

if ! sudo -u postgres pg_isready -q; then
  echo "ERROR: PostgreSQL is not running"
  exit 1
fi

echo "Starting PostgreSQL backup mode..."
sudo -u postgres psql -Xqtc "SELECT pg_backup_start(label => 'btrfs_snapshot', fast => false);"

# Ensure we stop backup mode even if the snapshot fails
trap 'echo "Stopping PostgreSQL backup mode..."; sudo -u postgres psql -Xqtc "SELECT pg_backup_stop(wait_for_archive => false);" > /dev/null' EXIT

echo "Creating snapper snapshot..."
SNAPSHOT_NUM=$(snapper -c "$SNAPPER_CONFIG" create --cleanup-algorithm timeline --description "postgres consistent snapshot" --print-number)
echo "Created snapshot #$SNAPSHOT_NUM"

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

PSQL_DIR=""
PSQL_PID=""
PSQL_FD_OPEN=false

cleanup() {
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
}
trap cleanup ERR EXIT

# Drive a long-running psql session held open by fd 9 on a fifo so that
# pg_backup_start / pg_backup_stop run in a single session (otherwise
# pg_backup_stop sees no active backup and errors out). Markers are synced
# via touch on a shared directory to avoid stdio buffering issues.
PSQL_DIR=$(mktemp -d --tmpdir snapper-psql.XXXXXX)
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
psql_run "SELECT pg_backup_start(label => 'btrfs_snapshot', fast => false);"

echo "Creating snapper snapshot..."
SNAPSHOT_NUM=$(snapper -c "$SNAPPER_CONFIG" create --cleanup-algorithm timeline --description "postgres consistent snapshot" --print-number)
echo "Created snapshot #$SNAPSHOT_NUM"

echo "Stopping PostgreSQL backup mode..."
psql_run "SELECT pg_backup_stop(wait_for_archive => false);"

printf '\\q\n' >&9
exec 9>&-
PSQL_FD_OPEN=false
wait "$PSQL_PID" || true
PSQL_PID=""

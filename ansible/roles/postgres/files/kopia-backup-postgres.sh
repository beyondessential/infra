#!/bin/bash

set -uxo pipefail

pgdatadir=${PGDATA:-/var/lib/postgresql/current/main}

: prepare the environment
tmpdir=/tmp/kopia-postgres
rm -rf $tmpdir || true
mkdir -p $tmpdir

# start a psql session we can control with a fifo
pin=$tmpdir/psql.in
pout=$tmpdir/psql.out
mkfifo $pin
touch $pout
: start psql
psql postgres < $pin | tee $pout &
psql_pid=$!

function cleanup {
  code=$?
  if [ $code -ne 0 ]; then
    set +x
    echo "========== ANY ERROR WILL BE ABOVE THIS LINE =========="
    set -x
  fi

  # any of these following steps could fail
  # but we need to clean up as much as possible
  # so let's make sure we're not exiting early
  set -e

  kill $psql_pid || true

  # we don't really need to remove the files in /tmp, as this is running
  # with PrivateTmp=true, so all of it disappears when the service stops
  # but for local testing, let's get rid of the entire directory anyway.
  rm -rf $tmpdir || true

  # exit once we finish cleanup;
  # without this the script continues!
  exit $code
}
trap cleanup ERR TERM INT EXIT

: keep the fifo open until we are done with it
exec 9<> $pin

: set await for the checkpoint to complete
inotifywait -e modify $pout &
wait_pid=$!

: get postgres to make a checkpoint
# fast=>true trades time for doing as much I/O as possible
# fast=>false takes longer but does negligible I/O, and can only take up to 5 minutes in default config
echo "SELECT pg_backup_start(label => 'kopia_backup', fast => false);" > $pin

: wait for the checkpoint to complete
wait $wait_pid

: take a snapshot of postgres
snap=$tmpdir/snapshot.json
kopia snapshot create --description="$(hostname) Postgres (data only)" --json $pgdatadir > $snap
jq . $snap

: set await for the snapshot to complete
inotifywait -e modify $pout &
wait_pid=$!

: tell postgres we are done
# technically we don't really need to do wait_for_archive because that's configured to `true`
# but better to follow what the documentation says exactly
pgmeta=$tmpdir/meta.csv
echo "\copy (SELECT * FROM pg_backup_stop(wait_for_archive => true)) TO '$pgmeta' WITH (FORMAT CSV)" > $pin

: wait for the backup to complete
wait $wait_pid

: stop psql
echo "\q" > $pin
wait $psql_pid || true

: parse the backup information
metadir=$tmpdir/meta
prog='split("\n") | join("\n") | capture("^(?<first>[^,]*),\"(?<second>[^\"]*)\",\"(?<third>[^\"]*)\"$")'
mkdir -p $metadir
jq -rRs "$prog | .first" $pgmeta > $metadir/lsn
jq -rRs "$prog | .second" $pgmeta > $metadir/backup_label
jq -rRs "$prog | .third" $pgmeta > $metadir/tablespace_map
if [ ! -s $metadir/tablespace_map ]; then
    rm $metadir/tablespace_map
fi

cp $snap $metadir/kopia-snapshot.json

: take a snapshot of the metadata
kopia snapshot create --description="$(hostname) Postgres (metadata)" $metadir

: done
true

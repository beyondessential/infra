#!/bin/bash

set -euxo pipefail

: prepare the environment
tmpdir=/tmp/kopia-postgres
mkdir -p $tmpdir

# start a psql session we can control with a fifo
pin=$tmpdir/psql.in
pout=$tmpdir/psql.out
mkfifo $pin
: start psql
psql postgres < $pin > $pout &
psql_pid=$!

# prep for the last phase
mountlow=$tmpdir/mount/low
mountoverlay=$tmpdir/mount/overlay
mkdir -p $mountlow $mountoverlay

function cleanup {
  set +e # any of these following steps could fail, but we need to clean up as much as possible
  kill $psql_pid
  umount $mountlow
  umount $mountoverlay

  # we don't really need to remove the files in /tmp, as this is running
  # with PrivateTmp=true, so all of it disappears when the service stops
  # but for local testing, let's get rid of the entire directory anyway.
  rm -rf $tmpdir
}
trap cleanup ERR TERM INT EXIT

: open the output as a file descriptor
exec 8< $pout

: keep the fifo open until we are done with it
exec 9<> $pin

: get postgres to make a checkpoint
# fast=>true trades time for doing as much I/O as possible
# fast=>false takes longer but does negligible I/O, and can only take up to 5 minutes in default config
echo "SELECT pg_backup_start(label => 'kopia_backup', fast => false);" > $pin

: wait for the checkpoint to complete
read -u 8

: take a snapshot of postgres
snap=$tmpdir/snapshot.json
kopia snapshot create --description="$(hostname) Postgres (data only)" --json /var/lib/postgresql > $snap
jq . $snap

: tell postgres we are done
# technically we don't really need to do wait_for_archive because that's configured to `true`
# but better to follow what the documentation says exactly
pgmeta=$tmpdir/meta.csv
echo "\copy (SELECT * FROM pg_backup_stop(wait_for_archive => true)) TO '$pgmeta' WITH (FORMAT CSV)" > $pin

: wait for the backup to complete
read -u 8

: stop psql
echo "\q" > $pin
timeout 5 wait $psql_pid || true
kill TERM $psql_pid
timeout 5 wait $psql_pid || true
kill KILL $psql_pid || true

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

# now this is the fun part:
# we need to write the two files parsed from the pg_backup_stop return value...
# TO THE BACKUP WE JUST TOOK
# this is obviously not possible because kopia snapshots are immutable
#
# so, we could do something easy, which makes restoring harder:
# - write the files somewhere
# - write a file with the snapshot ID or something
#
# or, we can do something insane, which makes restoring trivial:
# - mount the snapshot as a read-only filesystem
# - mount $metadir as an overlay on top of it
# - have kopia take another snapshot of the whole thing
# as kopia will have all but 3-4 small files already, this will be super fast
# and the output will be a directory that can be restored directly

: mount the snapshot
kopia mount $(jq -r .id $snap) $mountlow &
mount_pid=$!

: mount the overlay
mount -t overlay overlay -o lowerdir=$mountlow:$metadir $mountoverlay

: take a snapshot of the overlay
kopia snapshot create --description="$(hostname) Postgres" --json $mountoverlay

: unmount
kill TERM $mount_pid
timeout 10 wait $mount_pid || true
kill KILL $mount_pid || true
fusermount -u $mountoverlay || true
umount $mountlow

: done

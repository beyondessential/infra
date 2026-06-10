#!/bin/bash

set -uxo pipefail

export KOPIA_CHECK_FOR_UPDATES=false

# the pgdatadir MUST be *entirely* readable by the kopia user
# this isn't usually the case: even when kopia is part of the postgres group,
# pg writes its files group-unreadable. you can fix this using bindfs as root
# before running the script, and setting PGDATA accordingly, e.g.
# sudo bindfs -r -u kopia /var/lib/postgresql /path/to/kopia/pgdata
pgdatadir=${PGDATA:-/var/lib/postgresql/current/main}

ls $pgdatadir
if [ ! -f "$pgdatadir/PG_VERSION" ]; then
  echo PGDATA is not a postgresql data dir!
  exit 1
fi

# this is optimised for kernel 6.6+
# see https://trapexit.github.io/mergerfs/quickstart/ for lower kernels
mergerfs_opts="cache.files=off,category.create=pfrd,func.getattr=newest,dropcacheonclose=false"

: prepare the environment
tmpdir=${TMPDIR:-/tmp/kopia-postgres}
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

# prep for the last phase
mountlow=$tmpdir/mount/low
mountoverlay=$tmpdir/mount/postgresql
mkdir -p $mountlow $mountoverlay

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
  # Mounts may already have been torn down inline; silence the
  # "not found in mtab" warning when they have.
  fusermount -u $mountlow 2>/dev/null || true
  fusermount -u $mountoverlay 2>/dev/null || true

  # $tmpdir lives directly under /run (root-owned); only the systemd
  # ExecStopPost step can unlink it. Clear contents here.
  find "$tmpdir" -mindepth 1 -delete 2>/dev/null || true

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

: bind mount pgdata to the final destination
# this makes the paths better and also makes the second snapshot WAY faster
bindfs $pgdatadir $mountoverlay

: set ignore policy for postgres-specific files
kopia policy set \
  --add-ignore="postmaster.pid" \
  --add-ignore="*.log" \
  --add-ignore="pg_stat_tmp/*" \
  --add-ignore="lost+found" \
  $mountoverlay

: take a snapshot of postgres
snap=$tmpdir/snapshot.json
kopia snapshot create --tags area:postgres --tags type:ext4 --description="$(hostname) Postgres (data only)" --json $mountoverlay > $snap
jq . $snap

: unbind pgdata
fusermount -u $mountoverlay

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

# now this is the fun part:
# we need to write the files parsed from the pg_backup_stop return value...
# TO THE BACKUP WE JUST TOOK
# this is obviously not possible because kopia snapshots are immutable
#
# so, we could do something easy, which makes restoring harder:
# - write the files somewhere
# - write a file with the snapshot ID or something
# - take a snapshot of that
#
# or, we can do something insane, which makes restoring trivial:
# - mount the snapshot as a read-only filesystem
# - mount $metadir as an overlay on top of it
# - have kopia take another snapshot of the whole thing
# as kopia will have all but 3-4 small files already, this will be super fast
# and the output will be a directory that can be restored directly

: mount the snapshot
kopia mount --fuse-allow-other $(jq -r .id $snap) $mountlow &
mount_pid=$!
while [ ! -f $mountlow/PG_VERSION ]; do sleep 1; done

ls -shall $mountlow
ls -shall $metadir

: mount the overlay
mergerfs -o "$mergerfs_opts" $mountlow:$metadir $mountoverlay
ls -shall $mountoverlay

: take a snapshot of the overlay
kopia snapshot create --tags area:postgres --tags type:ext4 --description="$(hostname) Postgres" --json $mountoverlay

: unlist the data-only snapshot
# deletes in kopia are just markers; in this case all we're doing is removing
# the "(data only)" snapshot name from the list, but because all the data is
# contained in the final overlay snapshot, including the original snapshot
# metadata (the kopia-snapshot.json file), no data is lost.
kopia snapshot delete $(jq -r .id $snap) --delete

: unmount
kill -15 $mount_pid
wait $mount_pid || true
fusermount -u $mountoverlay || true
fusermount -u $mountlow || true

: done
true

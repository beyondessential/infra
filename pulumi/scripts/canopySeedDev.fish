#!/usr/bin/env fish
# Seed the canopy/dev database with Canopy's fake fleet, once.
#
# Canopy's seed binary (crates/database/src/bin/seed.rs) truncates the application
# tables and fills them with obviously fake data. It is not in the image and refuses
# release builds, so this runs a local debug build of it from a Canopy checkout,
# against the dev primary through a port-forward.
#
# Refuses to run unless:
#   - the namespace is tamanu-meta-dev on the main cluster (nothing else is accepted);
#   - the checkout's migrations are exactly the ones applied to the dev database, so
#     the seed's code matches the schema the deployed image migrated to;
#   - the database is fresh (no devices, only the nil application), unless --reseed.
#
# Afterwards it deletes the admins the seed inserts, so administrative access to the
# dev instance comes only from the tailnet policy grant.
#
# Usage:
#   canopySeedDev.fish CANOPY_CHECKOUT [--reseed]
#
# Needs kubectl access to the main cluster, and cargo. Read it through before running.

argparse reseed -- $argv
or exit 2

set -l context main
set -l ns tamanu-meta-dev
set -l port 15432

set -l canopy_dir $argv[1]
if test -z "$canopy_dir"; or not test -f "$canopy_dir/crates/database/src/bin/seed.rs"
    echo "usage: canopySeedDev.fish CANOPY_CHECKOUT [--reseed]" >&2
    exit 2
end
set canopy_dir (realpath $canopy_dir)

set -l k kubectl --context $context -n $ns

function die
    echo "error: $argv" >&2
    exit 1
end

# Fixed rather than taken as an argument, so no typo or default can aim this at prod.
test "$ns" = tamanu-meta-dev; or die "namespace must be tamanu-meta-dev"
$k get namespace $ns >/dev/null; or die "no namespace $ns on context $context"

set -l primary ($k get cluster.postgresql.cnpg.io meta-db -o jsonpath='{.status.currentPrimary}')
test -n "$primary"; or die "meta-db has no current primary"

function sql --inherit-variable k --inherit-variable primary
    $k exec $primary -c postgres -- psql -X -v ON_ERROR_STOP=1 -d app -tAc $argv[1]
end

# The migrator Job ran the image's migrations; the seed must be built from the same set.
set -l applied (sql 'SELECT version FROM __diesel_schema_migrations ORDER BY version')
or die "cannot read the migrations table; has the migrator Job completed?"
# Diesel's version is the directory name up to the first `_`, with `-` removed. Its
# all-zero initial setup migration is left out of both sides.
set -l local (for d in $canopy_dir/migrations/*/
        basename $d | string replace -r '_.*' '' | string replace -a - ''
    end | string match -v -r '^0+$' | sort)
set -l applied_user (string match -v -r '^0+$' $applied | sort)
if test "$local" != "$applied_user"
    echo "migrations in checkout but not applied:" >&2
    for v in $local
        contains -- $v $applied_user; or echo "  $v" >&2
    end
    echo "migrations applied but not in checkout:" >&2
    for v in $applied_user
        contains -- $v $local; or echo "  $v" >&2
    end
    die "check out the commit the dev image was built from (its tag is sha-<commit>)"
end

set -l devices (sql 'SELECT count(*) FROM devices')
set -l apps (sql 'SELECT count(*) FROM applications')
if test "$devices" -ne 0 -o "$apps" -gt 1
    if not set -q _flag_reseed
        die "database is not fresh ($devices devices, $apps applications); pass --reseed to truncate and reseed"
    end
    echo "--reseed: truncating $devices devices and $apps applications"
end

set -l password ($k get secret meta-db-app -o jsonpath='{.data.password}' | base64 -d)
test -n "$password"; or die "no password in secret meta-db-app"

$k port-forward pod/$primary $port:5432 >/dev/null &
set -l pf $last_pid
function cleanup --on-event fish_exit --inherit-variable pf
    kill $pf 2>/dev/null
end
for i in (seq 20)
    nc -z 127.0.0.1 $port 2>/dev/null; and break
    sleep 0.5
end
nc -z 127.0.0.1 $port; or die "port-forward to $primary did not come up"

pushd $canopy_dir
env DATABASE_URL="postgres://app:"(string escape --style=url -- $password)"@127.0.0.1:$port/app" \
    cargo run --bin seed
set -l seed_status $status
popd
test $seed_status -eq 0; or die "seed failed"

sql 'DELETE FROM admins'; or die "seed done, but deleting the seeded admins failed"
echo "seeded; admin allowlist is empty"

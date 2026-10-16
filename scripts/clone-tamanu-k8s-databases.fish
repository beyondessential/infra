#!/usr/bin/env fish

# Copy every CNPG database from one tamanu namespace into another.
#
# For moving a deployment to a new stack, where the new namespace has already
# been stood up and provisioned and its data is to be replaced wholesale by the
# old one's.
#
# Usage:
#   scripts/clone-tamanu-k8s-databases.fish CONTEXT SRC_NS DST_NS [--execute]
#
# Read this through before running with --execute: it replaces the contents of
# every database in DST_NS.

set -l dumpdir (mktemp -d)

argparse execute -- $argv; or exit 1

if test (count $argv) -lt 3
    echo "usage: clone-tamanu-k8s-databases.fish CONTEXT SRC_NS DST_NS [--execute]" >&2
    exit 1
end

set -l context $argv[1]
set -l src $argv[2]
set -l dst $argv[3]

function primary_of -a context -a namespace -a cluster
    kubectl --context=$context -n $namespace get cluster.postgresql.cnpg.io $cluster \
        -o jsonpath='{.status.currentPrimary}' 2>/dev/null
end

set -l clusters (kubectl --context=$context -n $src get cluster.postgresql.cnpg.io \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | string match -er .)

if test (count $clusters) -eq 0
    echo "no postgres clusters in $src" >&2
    exit 1
end

echo "Clusters to copy: $clusters"
echo

# The servers hold connections and take locks, and pg_restore --clean has to drop
# every object it replaces. Scale them away first and put them back afterwards,
# rather than racing them.
set -l scaled
if set -q _flag_execute
    echo "== quiescing $dst"
    for entry in (kubectl --context=$context -n $dst get deploy \
            -o jsonpath='{range .items[*]}{.metadata.name}={.spec.replicas}{"\n"}{end}' \
            | string match -er .)
        set -a scaled $entry
        kubectl --context=$context -n $dst scale deploy (string split '=' -- $entry)[1] --replicas=0 >/dev/null
    end
    echo "  scaled down "(count $scaled)" deployment(s)"
    echo
end

for cluster in $clusters
    set -l src_pod (primary_of $context $src $cluster)
    set -l dst_pod (primary_of $context $dst $cluster)

    echo "== $cluster: $src/$src_pod -> $dst/$dst_pod"
    if test -z "$src_pod" -o -z "$dst_pod"
        echo "  missing a primary on one side; is $cluster present in both?" >&2
        exit 1
    end

    if not set -q _flag_execute
        echo "  would dump and restore"
        continue
    end

    # Custom format so the restore can --clean. Ownership and grants are carried
    # across deliberately: CNPG names its roles the same in every namespace, so
    # `app` exists on both sides, and the application connects as `app` — restore
    # without them and every table lands owned by postgres with no grants, which
    # the servers meet as "permission denied for table local_system_facts".
    kubectl --context=$context -n $src exec $src_pod -c postgres -- \
        pg_dump -U postgres -Fc app >$dumpdir/$cluster.dump
    or begin
        echo "  dump failed" >&2
        exit 1
    end
    echo "  dumped "(du -h $dumpdir/$cluster.dump | cut -f1)

    # --clean --if-exists drops each object before recreating it, which is what
    # replaces the freshly provisioned schema. pg_restore reports non-fatal
    # errors for objects that were not there to drop, hence --exit-on-error is
    # not used; the row counts below are the real check.
    kubectl --context=$context -n $dst exec -i $dst_pod -c postgres -- \
        pg_restore -U postgres --clean --if-exists -d app \
        <$dumpdir/$cluster.dump 2>&1 | rg -c "^pg_restore: (error|warning)" \
        | xargs -I{} echo "  restore reported {} error/warning line(s)"

    # Tables and their owner on both sides. The owner matters as much as the
    # count: the application connects as `app` and cannot read tables owned by
    # anyone else, so a clone that copied every row but not its ownership looks
    # complete here and fails at startup.
    for side in "src:$src_pod:$src" "dst:$dst_pod:$dst"
        set -l parts (string split ':' -- $side)
        # stderr is kept: a check that cannot report its own failure is worse than
        # no check, because an empty line reads as "nothing wrong".
        set -l owners (kubectl --context=$context -n $parts[3] exec $parts[2] -c postgres -- \
            psql -U postgres -d app -tAc \
            "select tableowner || ': ' || count(*) from pg_tables where schemaname='public' group by tableowner;" \
            | string match -er . | string join '; ')
        if test -z "$owners"
            echo "  $parts[1] public tables by owner: (query returned nothing)" >&2
        else
            echo "  $parts[1] public tables by owner: $owners"
        end
    end

    # A facility database records the central it is bonded to, and the server
    # refuses to start when that disagrees with its config — "sync.host mismatch
    # ... you may need to drop and recreate the database". Cloning into a
    # deployment whose central lives at a new URL always trips it, so point the
    # fact at what this namespace's own config says.
    set -l synchost (kubectl --context=$context -n $dst exec $dst_pod -c postgres -- \
        psql -U postgres -d app -tAc \
        "select count(*) from local_system_facts where key = 'syncHost';" 2>/dev/null)
    if test "$synchost" = 1
        set -l cm (kubectl --context=$context -n $dst get cm -o json \
            | jq -r '.items[] | select(.metadata.labels["bes.tamanu/templated-from"]
                     // "" | startswith("config-facility-template-")) | .metadata.name')
        set -l want (kubectl --context=$context -n $dst get cm $cm \
            -o jsonpath='{.data.local\.json5}' \
            | string match -gr "^\s+host: '(https://[^']+)'" | head -1)

        if test -z "$want"
            echo "  could not read sync.host from $cm; set syncHost by hand" >&2
        else
            echo "  syncHost -> $want"
            kubectl --context=$context -n $dst exec $dst_pod -c postgres -- \
                psql -U postgres -d app -v ON_ERROR_STOP=1 \
                -c "update local_system_facts set value = '$want' where key = 'syncHost';" >/dev/null
            or begin
                echo "  failed to update syncHost" >&2
                exit 1
            end
        end
    end
end

if set -q _flag_execute
    echo
    echo "== restoring $dst"
    for entry in $scaled
        set -l parts (string split '=' -- $entry)
        kubectl --context=$context -n $dst scale deploy $parts[1] --replicas=$parts[2] >/dev/null
    end
    echo "  scaled "(count $scaled)" deployment(s) back"
    echo
    echo "The restored databases carry the source deployment's facility ids and"
    echo "device facts. Rename them next, before the servers are trusted:"
    echo "  scripts/rename-tamanu-facility.fish $context $dst OLD_ID NEW_ID --execute"
    echo "  scripts/repoint-tamanu-facility-config.fish $context $dst OLD_ID NEW_ID --execute"
else
    echo
    echo "Dry run. Re-run with --execute to copy."
end

rm -rf $dumpdir

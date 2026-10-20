#!/usr/bin/env fish

# Copy every CNPG database from one tamanu namespace into another.
#
# For moving a deployment to a new stack, or restoring one from recovered
# clusters (docs/sops/restore-databases-from-backup.md), where the target
# namespace has already been stood up and provisioned and its data is to be
# replaced wholesale by the source's.
#
# Usage:
#   scripts/clone-tamanu-k8s-databases.fish CONTEXT SRC_NS DST_NS [--execute]
#
# Read this through before running with --execute: it drops and recreates every
# database in DST_NS.

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

# Argo CD's hook Jobs (migrators, reporting grants) write to the databases on every
# sync, and a migrator that runs mid-restore leaves a mix of both schemas. Turn off
# automated sync and stop any running operation first; the policy is put back at
# the end, exactly as it was.
set -l argo_ns argocd-system
set -l automated
if set -q _flag_execute; and kubectl --context=$context -n $argo_ns get application $dst >/dev/null 2>&1
    echo "== stopping Argo CD for $dst"
    set automated (kubectl --context=$context -n $argo_ns get application $dst \
        -o jsonpath='{.spec.syncPolicy.automated}')
    if test -n "$automated"
        kubectl --context=$context -n $argo_ns patch application $dst --type json \
            -p '[{"op":"remove","path":"/spec/syncPolicy/automated"}]' >/dev/null
    end
    set -l phase (kubectl --context=$context -n $argo_ns get application $dst \
        -o jsonpath='{.status.operationState.phase}')
    if test "$phase" = Running
        kubectl --context=$context -n $argo_ns patch application $dst --type merge \
            -p '{"status":{"operationState":{"phase":"Terminating"}}}' >/dev/null
        for i in (seq 40)
            set phase (kubectl --context=$context -n $argo_ns get application $dst \
                -o jsonpath='{.status.operationState.phase}')
            contains -- $phase Running Terminating; or break
            sleep 3
        end
    end
    if contains -- "$phase" Running Terminating
        echo "  the Argo CD operation did not stop" >&2
        exit 1
    end
    kubectl --context=$context -n $dst delete jobs --all --wait=true >/dev/null
    echo "  automated sync off, operation $phase, hook Jobs deleted"
    echo
end

# The servers hold connections and take locks, and each database is dropped before
# it is restored. Scale them away first and put them back afterwards, rather than
# racing them.
set -l scaled
if set -q _flag_execute
    echo "== quiescing $dst"
    for entry in (kubectl --context=$context -n $dst get deploy \
            -o jsonpath='{range .items[*]}{.metadata.name}={.spec.replicas}{"\n"}{end}' \
            | string match -er .)
        set -a scaled $entry
        kubectl --context=$context -n $dst scale deploy (string split '=' -- $entry)[1] --replicas=0 >/dev/null
    end
    kubectl --context=$context -n $dst wait --for=delete pod -l '!cnpg.io/cluster' --timeout=300s >/dev/null 2>&1
    set -l left (kubectl --context=$context -n $dst get pods --no-headers -l '!cnpg.io/cluster' 2>/dev/null | count)
    if test $left -gt 0
        echo "  $left non-database pod(s) still running" >&2
        exit 1
    end
    echo "  scaled down "(count $scaled)" deployment(s)"
    echo
end

# What must match between the two sides once a database is restored. The owner of
# the tables matters as much as their count: the application connects as `app` and
# cannot read tables owned by anyone else, so a clone that copied every row but not
# its ownership looks complete and fails at startup.
set -l summary "select (select count(*) from \"SequelizeMeta\") || ' migrations, '
  || (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public') || ' constraints, '
  || (select count(*) from pg_indexes where schemaname = 'public') || ' indexes, '
  || (select count(*) from pg_tables where schemaname = 'public' and tableowner = 'app') || ' tables owned by app';"

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

    # Ownership and grants are carried across deliberately: CNPG names its roles
    # the same in every namespace, so `app` exists on both sides, and the
    # application connects as `app` — restore without them and every table lands
    # owned by postgres with no grants, which the servers meet as "permission
    # denied for table local_system_facts".
    kubectl --context=$context -n $src exec $src_pod -c postgres -- \
        pg_dump -U postgres -Fc app >$dumpdir/$cluster.dump
    or begin
        echo "  dump failed" >&2
        exit 1
    end
    echo "  dumped "(du -h $dumpdir/$cluster.dump | cut -f1)

    # Restoring with --clean over the provisioned schema leaves behind whatever it
    # cannot drop (an object something else depends on) and skips what then
    # collides, so the target is recreated empty instead, with the encoding and
    # locale it was created with.
    set -l locale (kubectl --context=$context -n $dst exec $dst_pod -c postgres -- \
        psql -U postgres -d postgres -tA -F ' ' -c \
        "select pg_encoding_to_char(encoding), datcollate, datctype from pg_database where datname = 'app';" \
        | string split ' ')
    if test (count $locale) -ne 3
        echo "  could not read the encoding and locale of $dst's app database" >&2
        exit 1
    end
    printf '%s\n' \
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'app' and pid <> pg_backend_pid();" \
        "drop database app;" \
        "create database app owner app encoding '$locale[1]' lc_collate '$locale[2]' lc_ctype '$locale[3]' template template0;" \
        | kubectl --context=$context -n $dst exec -i $dst_pod -c postgres -- \
        psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q >/dev/null
    or begin
        echo "  could not recreate the app database" >&2
        exit 1
    end

    # Into an empty database there should be nothing to report, so every line is
    # shown; the summary comparison below is the real check.
    kubectl --context=$context -n $dst exec -i $dst_pod -c postgres -- \
        pg_restore -U postgres -d app <$dumpdir/$cluster.dump 2>&1 \
        | string match -r '^pg_restore: (?:error|warning).*' | string replace -r '^' '  '

    # stderr is kept: a check that cannot report its own failure is worse than no
    # check, because an empty line reads as "nothing wrong".
    set -l want (kubectl --context=$context -n $src exec $src_pod -c postgres -- \
        psql -U postgres -d app -tAc "$summary")
    set -l got (kubectl --context=$context -n $dst exec $dst_pod -c postgres -- \
        psql -U postgres -d app -tAc "$summary")
    echo "  src: $want"
    echo "  dst: $got"
    if test -z "$want" -o "$want" != "$got"
        echo "  $cluster does not match its source; stopping with $dst scaled down and Argo CD off" >&2
        exit 1
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
        # facility-N-db reads its config from config-facility-N.
        set -l cm config-(string replace -r -- '-db$' '' $cluster)
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
    # Re-enabling automated sync starts a sync, which runs the migrators against
    # the restored databases before the servers roll.
    if test -n "$automated"
        kubectl --context=$context -n $argo_ns patch application $dst --type merge \
            -p "{\"spec\":{\"syncPolicy\":{\"automated\":$automated}}}" >/dev/null
        echo "  automated sync restored"
    end
    echo
    echo "If $src belongs to another deployment, the restored databases carry its"
    echo "facility ids and device facts. Rename them next, before the servers are trusted:"
    echo "  scripts/rename-tamanu-facility.fish $context $dst OLD_ID NEW_ID --execute"
    echo "  scripts/repoint-tamanu-facility-config.fish $context $dst OLD_ID NEW_ID --execute"
else
    echo
    echo "Dry run. Re-run with --execute to copy."
end

rm -rf $dumpdir

#!/usr/bin/env fish

# Rename a Tamanu facility in an on-k8s deployment, across both its databases.
#
# Usage:
#   scripts/rename-tamanu-facility.fish CONTEXT NAMESPACE OLD_ID NEW_ID [NEW_CODE] [--execute]
#
# Without --execute it only reports what it would touch. Review
# rename-tamanu-facility.sql before running this with --execute.

set -l here (dirname (status --current-filename))

argparse execute -- $argv; or exit 1

if test (count $argv) -lt 4
    echo "usage: rename-tamanu-facility.fish CONTEXT NAMESPACE OLD_ID NEW_ID [NEW_CODE] [--execute]" >&2
    exit 1
end

set -l context $argv[1]
set -l namespace $argv[2]
set -l old_id $argv[3]
set -l new_id $argv[4]
set -l new_code $new_id
if test (count $argv) -ge 5
    set new_code $argv[5]
end

# The primary of each CNPG cluster in the namespace: writing to a replica fails,
# and which instance is primary changes with failovers, so ask rather than assume.
set -l pods (kubectl --context=$context -n $namespace get cluster.postgresql.cnpg.io \
    -o jsonpath='{range .items[*]}{.status.currentPrimary}{"\n"}{end}' | string match -er .)

if test (count $pods) -eq 0
    echo "no postgres clusters found in $namespace" >&2
    exit 1
end

function run_sql -a context -a namespace -a pod -a file
    kubectl --context=$context -n $namespace exec -i $pod -c postgres -- \
        psql -U postgres -d app -X -q $argv[5..] -f - <$file
end

for pod in $pods
    echo "=== $namespace/$pod ==="
    echo "-- before --"
    run_sql $context $namespace $pod $here/rename-tamanu-facility-counts.sql \
        -v old_id=$old_id -v new_id=$new_id

    if set -q _flag_execute
        echo "-- renaming --"
        run_sql $context $namespace $pod $here/rename-tamanu-facility.sql \
            -v old_id=$old_id -v new_id=$new_id -v new_code=$new_code
        or begin
            echo "rename failed on $pod, stopping" >&2
            exit 1
        end

        echo "-- after --"
        run_sql $context $namespace $pod $here/rename-tamanu-facility-counts.sql \
            -v old_id=$old_id -v new_id=$new_id
    end

    echo "-- staying on $old_id --"
    run_sql $context $namespace $pod $here/rename-tamanu-facility-staying.sql -t \
        -v old_id=$old_id
end

echo
if not set -q _flag_execute
    echo "Dry run. Re-run with --execute to apply."
    exit 0
end

echo "The facility database also holds the id in local_system_facts, and the"
echo "facility server reads it from a ConfigMap Pulumi will not update. Both are"
echo "handled by scripts/repoint-tamanu-facility-config.fish."

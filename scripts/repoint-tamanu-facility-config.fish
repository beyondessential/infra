#!/usr/bin/env fish

# Point an on-k8s facility server at a renamed facility.
#
# Pulumi cannot do this: templatedConfig creates the facility's ConfigMap with
# ignoreChanges on `data`, because the rendered config carries a generated
# auth.secret that a re-render would rotate. So a facilityNames change moves the
# Gateway hostname but never reaches the config the server actually reads.
#
# Usage:
#   scripts/repoint-tamanu-facility-config.fish CONTEXT NAMESPACE OLD_ID NEW_ID [NEW_FQDN] [--execute]
#
# Review what this prints in dry-run before running with --execute.

argparse execute -- $argv; or exit 1

if test (count $argv) -lt 4
    echo "usage: repoint-tamanu-facility-config.fish CONTEXT NAMESPACE OLD_ID NEW_ID [NEW_FQDN] [--execute]" >&2
    exit 1
end

set -l context $argv[1]
set -l namespace $argv[2]
set -l old_id $argv[3]
set -l new_id $argv[4]
set -l new_fqdn ''
if test (count $argv) -ge 5
    set new_fqdn $argv[5]
end

# The facility server's config, identified by the template it came from rather
# than by name: Pulumi suffixes the name with a hash that changes. Any
# config-facility template counts, not just the demo one.
set -l config_maps (kubectl --context=$context -n $namespace get cm -o json \
    | jq -r '.items[]
        | select(.metadata.labels["bes.tamanu/templated-from"]
                 // "" | startswith("config-facility-template-"))
        | .metadata.name')

if test (count $config_maps) -eq 0
    echo "no facility config found in $namespace" >&2
    exit 1
end

for cm in $config_maps
    echo "=== configmap $cm ==="
    # string collect keeps the newlines: without it fish splits the config into a
    # list and rejoins it on spaces, flattening the file to a single line.
    set -l current (kubectl --context=$context -n $namespace get cm $cm \
        -o jsonpath='{.data.local\.json5}' | string collect)

    if not string match -qr -- $old_id "$current"
        echo "does not mention $old_id, skipping"
        continue
    end

    # Match the id with its surrounding quotes, so only whole values are replaced.
    # This is what protects syncApiConnection.host: that is
    # 'http://facility-N-sync', named after the facility's position in the stack
    # rather than its id, and must not move with a rename.
    set -l updated (string replace -a "'$old_id'" "'$new_id'" -- "$current" | string collect)
    if test -n "$new_fqdn"
        set updated (string replace -r "canonicalHostName: 'https://[^']+'" "canonicalHostName: 'https://$new_fqdn'" -- "$updated" | string collect)
    end

    echo "-- diff --"
    diff -u (echo "$current" | psub) (echo "$updated" | psub); or true

    if set -q _flag_execute
        # -c and string collect both matter: jq pretty-prints by default, and fish
        # splits a command substitution on newlines, so a multi-line patch becomes
        # one argument per line and kubectl sees the tail as stray positionals.
        kubectl --context=$context -n $namespace patch cm $cm --type=merge \
            -p (jq -c -n --arg value "$updated" '{data: {"local.json5": $value}}' | string collect)
    end
end

# The facility database records the same id, and the server compares the two at
# startup — "Device ID mismatch: <db> vs <config>" — so moving only the ConfigMap
# leaves it refusing to boot. This used to be printed for someone to run by hand,
# which is a good way to end up with a facility that is half renamed.
set -l primary (kubectl --context=$context -n $namespace get cluster.postgresql.cnpg.io \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.currentPrimary}{"\n"}{end}' \
    | string match -er "^facility" | string split \t)[2]

echo
echo "=== local_system_facts on $primary ==="
if test -z "$primary"
    echo "no facility postgres cluster found in $namespace; set deviceId and" >&2
    echo "facilityIds to $new_id by hand before restarting the server" >&2
else if set -q _flag_execute
    kubectl --context=$context -n $namespace exec $primary -c postgres -- \
        psql -U postgres -d app -v ON_ERROR_STOP=1 \
        -c "update local_system_facts set value = '$new_id' where key = 'deviceId';" \
        -c "update local_system_facts set value = '[\"$new_id\"]' where key = 'facilityIds';" \
        -c "select key, value from local_system_facts where key in ('deviceId','facilityIds');"
    or begin
        echo "failed to update local_system_facts" >&2
        exit 1
    end
else
    echo "would set deviceId and facilityIds to $new_id"
end

echo
if set -q _flag_execute
    # By name rather than label: the app deployments carry no labels of their own,
    # and app.kubernetes.io/name=facility-N selects the database instead.
    echo "Restart the facility server so it rereads the config:"
    echo "  kubectl --context=$context -n $namespace get deploy -o name \\"
    echo "    | grep -E '/facility-[0-9]+-(api|sync|tasks)' \\"
    echo "    | xargs -r kubectl --context=$context -n $namespace rollout restart"
else
    echo "Dry run. Re-run with --execute to apply."
end

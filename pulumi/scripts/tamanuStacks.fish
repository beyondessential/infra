#!/usr/bin/env fish
# Preview, apply, or destroy tamanu-on-k8s stacks across clusters.
#
# Stacks are picked from the backend, not from local Pulumi.*.yaml files, and
# each one's cluster is read from its state (the k8s-core stack it references,
# or failing that whichever selected cluster holds its namespace). Each runs
# against a throwaway kubeconfig switched to that cluster's context, because
# the program refuses to run against any cluster but its own and the shared
# kubeconfig's current context may point elsewhere.
#
# Modes:
#   (default)          refresh configs, then preview
#   --up               refresh configs, then apply
#   --destroy          preview the destroy only
#   --destroy --yes    delete the stack's namespace, then destroy and remove
#                      the stack. CI creates release and branch namespaces as
#                      HNC subnamespaces of tamanu-super, which HNC only lets go
#                      through their anchor, and while a namespace exists HNC
#                      recreates its HierarchyConfiguration as fast as Pulumi
#                      deletes it, so the namespace has to go first.
#
# Ghost stacks, whose cluster side is gone (no namespace, or an empty one over a
# day old: no Deployments, StatefulSets, CNPG clusters or volumes) while their
# state still lists resources, are listed in preview modes. In --up and
# --destroy --yes runs they are removed after a confirmation: the empty
# namespace is deleted and the stack forgotten with `stack rm --force`. They
# are never destroyed or updated, because replaying their NamespacePatch would
# recreate the namespace and an up would rebuild an abandoned environment.
#
# Positional arguments are glob patterns over stack names (default: every
# stack); --except removes matches again. Examples:
#   scripts/tamanuStacks.fish --up
#   scripts/tamanuStacks.fish --cluster shared-demos-demo --up
#   scripts/tamanuStacks.fish --up fiji-demo 'release-2-6*'
#   scripts/tamanuStacks.fish --up --refresh fsm-demo   # reconcile state with the cluster first
#   scripts/tamanuStacks.fish --destroy 'release-*' --except release-2-43 --except release-2-54

argparse 'up' 'destroy' 'yes' 'skip-refresh' 'refresh' 'c/cluster=+' 'x/except=+' -- $argv
or exit 1

set -l pulumi_root (realpath (status dirname)/..)
set -l project_dir $pulumi_root/tamanu/on-k8s
set -l clusters $_flag_cluster
if test (count $clusters) -eq 0
    set clusters tamanu-internal-main shared-demos-demo
end
set -l patterns $argv
if test (count $patterns) -eq 0
    set patterns '*'
end

if set -q _flag_up; and set -q _flag_destroy
    echo '--up and --destroy are exclusive' >&2
    exit 1
end
if set -q _flag_up; and set -q _flag_skip_refresh
    # Local stack configs lag behind CI deploys: an up from a stale one rolls the
    # environment back to whatever image tag it last saw.
    echo '--up always refreshes config first; drop --skip-refresh' >&2
    exit 1
end

set -l mode preview
if set -q _flag_up
    set mode up
else if set -q _flag_destroy
    set mode destroy-preview
    if set -q _flag_yes
        set mode destroy
    end
end

set -l refresh_flag
set -q _flag_refresh; and set refresh_flag --refresh

set -l logs (mktemp -d -t tamanuStacks.XXXXXX)
echo "logs: $logs"

# One kubeconfig per cluster, switched to the context whose API server is that
# cluster's Tailscale operator endpoint.
set -l raw (kubectl config view --raw -o json | string collect)
for cluster in $clusters
    set -l context (echo $raw | jq -r --arg c $cluster '
        (.clusters[] | select(.cluster.server | test("k8s-operator-" + $c + "\\\\.")) | .name) as $cl
        | .contexts[] | select(.context.cluster == $cl) | .name' | head -n1)
    if test -z "$context"
        echo "no kubeconfig context for cluster $cluster" >&2
        exit 1
    end
    echo $raw >$logs/kubeconfig-$cluster
    kubectl --kubeconfig $logs/kubeconfig-$cluster config use-context $context >/dev/null
end

# Destroy also takes stacks that hold nothing, so they get removed too.
set -l min_resources 1
if string match -q 'destroy*' $mode
    set min_resources 0
end
set -l stacks
for stack in (pulumi -C $project_dir stack ls --json | jq -r --argjson min $min_resources \
        '.[] | select((.resourceCount // 0) >= $min and (.updateInProgress | not)) | .name')
    set -l picked 0
    for p in $patterns
        string match -q -- $p $stack; and set picked 1
    end
    for p in $_flag_except
        string match -q -- $p $stack; and set picked 0
    end
    test $picked -eq 1; and set -a stacks $stack
end
if test (count $stacks) -eq 0
    echo 'no stacks match' >&2
    exit 1
end

# Delete through the anchor when there is one, or directly when the stack owns
# the namespace; a namespace the stack only references is left alone.
function __namespace_delete --argument-names kubeconfig ns managed
    if kubectl --kubeconfig $kubeconfig -n tamanu-super get subnamespaceanchor $ns >/dev/null 2>&1
        kubectl --kubeconfig $kubeconfig -n tamanu-super delete subnamespaceanchor $ns --wait --timeout=15m
    else if test "$managed" = true
        kubectl --kubeconfig $kubeconfig delete namespace $ns --ignore-not-found --wait --timeout=15m
    end
end

# A namespace older than a day with nothing that runs or holds data in it.
function __namespace_empty --argument-names kubeconfig ns
    set -l created (kubectl --kubeconfig $kubeconfig get namespace $ns -o jsonpath='{.metadata.creationTimestamp}')
    test (math (date +%s) - (date -d $created +%s)) -gt 86400; or return 1
    set -l held (kubectl --kubeconfig $kubeconfig -n $ns get deployments,statefulsets,clusters.postgresql.cnpg.io,persistentvolumeclaims \
        --no-headers --ignore-not-found 2>/dev/null)
    test (count $held) -eq 0
end

# CNPG clusters that are neither healthy nor hibernated. The program waits for
# its databases without a time limit, so an up against a broken one never ends.
function __unhealthy_databases --argument-names kubeconfig ns
    kubectl --kubeconfig $kubeconfig -n $ns get clusters.postgresql.cnpg.io --no-headers \
        -o custom-columns=NAME:.metadata.name,PHASE:.status.phase 2>/dev/null \
        | string match -rv -i 'healthy state|hibernat' | string replace -r '\s{2,}' ': '
end

echo '== classifying stacks'
set -l live
set -l live_cluster
set -l live_ns
set -l live_managed
set -l ghosts
set -l ghost_cluster
set -l ghost_ns
set -l ghost_present
set -l skipped
set -l unhealthy
for stack in $stacks
    # State runs to megabytes; held in a fish variable it takes minutes to echo.
    set -l state $logs/$stack.state.json
    pulumi -C $project_dir stack export -s $stack >$state 2>/dev/null
    set -l ns (jq -r '[.deployment.resources[]? | select(.type == "kubernetes:core/v1:Namespace" or .type == "kubernetes:core/v1:NamespacePatch") | .outputs.metadata.name // empty][0] // empty' $state)
    set -l ns_managed (jq -r '[.deployment.resources[]? | select(.type == "kubernetes:core/v1:Namespace") | (.external // false | not)][0] // false' $state)
    set -l cluster (jq -r '[.deployment.resources[]? | select(.type == "pulumi:pulumi:StackReference") | .outputs.name // .inputs.name | select(startswith("bes/k8s-core/")) | ltrimstr("bes/k8s-core/")][0] // empty' $state)
    test -z "$ns"; and set ns tamanu-$stack

    set -l found
    for c in $clusters
        if kubectl --kubeconfig $logs/kubeconfig-$c get namespace $ns >/dev/null 2>&1
            set found $c
            break
        end
    end
    test -z "$cluster"; and set cluster $found
    if test -z "$cluster"
        set -a skipped "$stack (cluster unknown)"
        continue
    end
    if not contains -- $cluster $clusters
        set -a skipped "$stack ($cluster)"
        continue
    end

    set -l kc $logs/kubeconfig-$cluster
    if not kubectl --kubeconfig $kc get namespace $ns >/dev/null 2>&1
        set -a ghosts $stack; set -a ghost_cluster $cluster; set -a ghost_ns $ns; set -a ghost_present false
    else if __namespace_empty $kc $ns
        set -a ghosts $stack; set -a ghost_cluster $cluster; set -a ghost_ns $ns; set -a ghost_present true
    else
        set -l broken (__unhealthy_databases $kc $ns)
        if test (count $broken) -gt 0 -a $mode != destroy -a $mode != destroy-preview
            set -a unhealthy "$stack ("(string join ', ' $broken)")"
            continue
        end
        set -a live $stack; set -a live_cluster $cluster; set -a live_ns $ns; set -a live_managed $ns_managed
    end
end
if test (count $unhealthy) -gt 0
    echo 'Skipping stacks with unhealthy databases (fix those first):'
    printf '  %s\n' $unhealthy
end

set -l remove_ghosts 0
if test (count $ghosts) -gt 0
    echo "Ghost stacks (cluster side gone, state left behind):"
    for i in (seq (count $ghosts))
        set -l what 'namespace gone'
        test $ghost_present[$i] = true; and set what 'namespace empty'
        echo "  $ghosts[$i] ($ghost_cluster[$i], $what)"
    end
    if test $mode = up -o $mode = destroy
        read -l -P 'Type "remove" to forget these stacks and delete their empty namespaces, anything else to skip them: ' answer
        test "$answer" = remove; and set remove_ghosts 1
    end
end

if test (count $live) -eq 0 -a $remove_ghosts -eq 0
    echo 'nothing to do'
    exit 0
end

if test $mode = preview -o $mode = up
    if not set -q _flag_skip_refresh
        echo '== refreshing configs'
        $pulumi_root/scripts/refreshConfigs.fish tamanu/on-k8s
        or begin
            echo 'config refresh failed' >&2
            exit 1
        end
    end
    echo '== building policy pack'
    npm --prefix $pulumi_root/policies run build >$logs/policies.log 2>&1
    or begin
        echo "policy pack build failed, see $logs/policies.log" >&2
        exit 1
    end
end

if test $mode = destroy; and test (count $live) -gt 0
    echo "About to DESTROY and remove these stacks (and their namespaces):"
    printf '  %s\n' $live
    read -l -P 'Type "destroy" to continue: ' answer
    if test "$answer" != destroy
        echo aborted
        exit 1
    end
end

set -l done
set -l failed
set -l removed

if test $remove_ghosts -eq 1
    for i in (seq (count $ghosts))
        set -l stack $ghosts[$i]
        set -l kc $logs/kubeconfig-$ghost_cluster[$i]
        set -l log $logs/$stack.log
        echo "== remove ghost $stack"
        set -l rc 0
        if test $ghost_present[$i] = true
            # Empty, so deleting it outright is safe even if the stack only
            # referenced it.
            __namespace_delete $kc $ghost_ns[$i] true >$log 2>&1
            set rc $status
        end
        if test $rc -eq 0
            pulumi -C $project_dir stack rm -s $stack --force --yes >>$log 2>&1
            set rc $status
        end
        if test $rc -eq 0
            set -a removed $stack
        else
            set -a failed $stack
            echo "   FAILED, see $log"
        end
    end
end

for i in (seq (count $live))
    set -l stack $live[$i]
    set -l cluster $live_cluster[$i]
    set -l ns $live_ns[$i]
    set -l kc $logs/kubeconfig-$cluster
    set -l log $logs/$stack.log

    echo "== $mode $stack on $cluster"
    set -l rc 0
    switch $mode
        case preview
            KUBECONFIG=$kc pulumi -C $project_dir preview -s $stack --diff $refresh_flag \
                --policy-pack $pulumi_root/policies >$log 2>&1
            set rc $status
        case up
            # SIGINT makes pulumi cancel cleanly and record what it did.
            KUBECONFIG=$kc timeout --signal=INT --kill-after=5m 45m \
                pulumi -C $project_dir up -s $stack --yes --skip-preview $refresh_flag \
                --policy-pack $pulumi_root/policies >$log 2>&1
            set rc $status
        case destroy-preview
            KUBECONFIG=$kc pulumi -C $project_dir destroy -s $stack --preview-only >$log 2>&1
            set rc $status
        case destroy
            __namespace_delete $kc $ns $live_managed[$i] >$log 2>&1
            set rc $status
            if test $rc -eq 0
                KUBECONFIG=$kc pulumi -C $project_dir destroy -s $stack --yes --skip-preview --remove >>$log 2>&1
                set rc $status
            end
            # Destroying the NamespacePatch of a stack that only references its
            # namespace is a server-side apply, which recreates the namespace
            # empty; it is no longer anchored, so delete it directly.
            if test $rc -eq 0
                kubectl --kubeconfig $kc delete namespace $ns --ignore-not-found --wait --timeout=15m >>$log 2>&1
                set rc $status
            end
    end
    if test $rc -eq 0
        set -a done $stack
        string match -r '^\s+[+~-]+ \d+ to \w+|^\s+\d+ unchanged|^\s+- \d+ (to )?delete' <$log | string trim | string join ', ' | sed 's/^/   /'
    else
        set -a failed $stack
        echo "   FAILED, see $log"
    end
end

echo
echo "$mode ok: "(count $done)", ghosts removed: "(count $removed)" of "(count $ghosts)", failed: "(count $failed)", unhealthy: "(count $unhealthy)", skipped: "(count $skipped)
for s in $unhealthy
    echo "  unhealthy: $s"
end
for s in $skipped
    echo "  skipped: $s"
end
for s in $failed
    echo "  failed: $s ($logs/$s.log)"
end
test (count $failed) -eq 0

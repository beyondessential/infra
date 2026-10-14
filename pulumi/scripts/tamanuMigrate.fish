#!/usr/bin/env fish
# Move tamanu/on-k8s stacks from the previous Pulumi program to Argo CD, in the two
# releases described in .workhorse/working-docs/p1/working-doc.md:
#
#   r1  mark every Pulumi-owned resource retain-on-delete, and leave a marker in the
#       namespace. State only; nothing changes in the cluster.
#   r2  hand the stack over to Argo CD. Requires the marker.
#
# Each stack is classified from the cluster first:
#   none      no namespace or no database cluster yet
#   argo      already has an Argo CD Application
#   unmarked  deployed by the previous program, no marker (needs r1)
#   marked    deployed by the previous program, with the marker (needs r2)
#
# By default this only prints what each stack is and what it would do. Nothing is
# written to the cluster or to Pulumi state unless --apply is given. Demos, `main`
# and release stacks are left out of an --apply run unless --all is given or they
# are named.
#
# The program runs from a throwaway checkout of the phase's branch, so the working
# tree is not touched, and each stack's config is refreshed from the backend
# first, as Tamanu CD would have it.
#
# Usage:
#   tamanuMigrate.fish PHASE [--apply] [--preview] [--all] [--ref REF] [STACK...]
#   tamanuMigrate.fish r1                   # plan, every stack
#   tamanuMigrate.fish r1 --preview x y     # also run `pulumi preview` for stacks x and y
#   tamanuMigrate.fish r1 --apply           # run r1 on the pull request stacks
#   tamanuMigrate.fish r2 --apply --all     # run r2 on every stack, demos included
#
# Needs kubectl access to the cluster that runs the deployments, and Pulumi access.
# It runs `pulumi up`, so read it through before running it with --apply.

set -l pulumi_root (realpath (status dirname)/..)
set -l repo_root (git -C $pulumi_root rev-parse --show-toplevel)
set -l project_dir tamanu/on-k8s
set -l org bes
set -l project tamanu-on-k8s

argparse a/apply p/preview all 'ref=' -- $argv
or exit 2

set -l phase $argv[1]
set -l named $argv[2..-1]
if not contains -- "$phase" r1 r2
    echo "usage: tamanuMigrate.fish r1|r2 [--apply] [--preview] [--all] [--ref REF] [STACK...]" >&2
    exit 2
end

set -l ref origin/p1-$phase
set -q _flag_ref; and set ref $_flag_ref

git -C $repo_root fetch --quiet origin
or begin
    echo "could not fetch origin" >&2
    exit 1
end

set -l tmp (mktemp -d)
set -l wt $tmp/checkout
git -C $repo_root worktree add --quiet --detach $wt $ref
or begin
    echo "could not check out $ref" >&2
    rm -rf $tmp
    exit 1
end
function __tamanuMigrate_cleanup --on-event fish_exit --inherit-variable repo_root --inherit-variable wt --inherit-variable tmp
    git -C $repo_root worktree remove --force $wt 2>/dev/null
    rm -rf $tmp
end
ln -s $pulumi_root/node_modules $wt/pulumi/node_modules
set -l dir $wt/pulumi/$project_dir

set -l stacks (pulumi -C $dir stack ls --json | jq -r '.[].name')
if test (count $named) -gt 0
    set stacks $named
end

# Stacks that need a person's judgement rather than a sweep.
function __is_careful -a stack
    string match -qr -- '(^main$|-demo$|^release-)' $stack
end

function __classify -a ns
    if not kubectl get ns $ns >/dev/null 2>&1
        echo none
        return
    end
    if kubectl -n argocd-system get applications.argoproj.io $ns >/dev/null 2>&1
        echo argo
        return
    end
    # Deployed by the previous program: a database cluster that Argo does not track, or any
    # object with a name Pulumi generated (the stub's own TTL objects aside).
    set -l tracking (kubectl -n $ns get clusters.postgresql.cnpg.io central-db -o json 2>/dev/null \
        | jq -r '.metadata.annotations["argocd.argoproj.io/tracking-id"] // "legacy"')
    set -l generated (kubectl -n $ns get deploy,job,pdb,svc,cm,gateways.gateway.networking.k8s.io,httproutes.gateway.networking.k8s.io -o json 2>/dev/null \
        | jq '[.items[] | select(.metadata.annotations["pulumi.com/autonamed"] == "true" and (.metadata.name | startswith("ttl-") | not))] | length')
    if test "$tracking" != legacy; and test "$generated" = 0
        echo none
        return
    end
    set -l marker (kubectl -n $ns get cm migration -o jsonpath='{.data.phase}' 2>/dev/null)
    if test "$marker" = retained
        echo marked
    else
        echo unmarked
    end
end

set -l wanted unmarked
test $phase = r2; and set wanted marked

set -l failed
set -l done_count 0
printf '%-52s %-10s %s\n' STACK STATE ACTION
for stack in $stacks
    set -l full $org/$project/$stack
    pulumi -C $dir config refresh -s $full >/dev/null 2>&1
    or begin
        printf '%-52s %-10s %s\n' $stack ? "config refresh failed"
        set -a failed $stack
        continue
    end
    set -l ns (pulumi -C $dir config get namespace -s $full 2>/dev/null)
    test -n "$ns"; or set ns tamanu-$stack
    set -l state (__classify $ns)

    set -l action skip
    if test $state = $wanted
        set action run
        if __is_careful $stack; and test (count $named) -eq 0; and not set -q _flag_all
            set action "left out (demo, main or release: name it or use --all)"
        end
    else if test $state = unmarked; and test $phase = r2
        set action "needs r1 first"
    end
    printf '%-52s %-10s %s\n' $stack $state "$action"

    test "$action" = run; or continue

    if set -q _flag_preview
        pulumi -C $dir preview -s $full --refresh --diff >$tmp/preview-$stack.log 2>&1
        or begin
            echo "  preview failed, see $tmp/preview-$stack.log" >&2
            set -a failed $stack
            continue
        end
        echo "  preview ok"
    end

    if set -q _flag_apply
        pulumi -C $dir up -s $full --refresh --yes
        or begin
            echo "  up failed for $stack, stopping" >&2
            set -a failed $stack
            break
        end
        set done_count (math $done_count + 1)
    end
end

echo
if set -q _flag_apply
    echo "$done_count stacks updated"
end
if test (count $failed) -gt 0
    echo "failed: $failed" >&2
    exit 1
end

#!/usr/bin/env bash
# Restart the Argo CD repo server of the cluster kubectl points at, then hard-refresh the Tamanu
# Applications rendered by one renderer channel, and wait for them to render again.
#
#   refresh-channel.sh <stable|canary>
#
# Run by the promotion workflow after a channel tag has moved, and by hand to repeat that for one
# cluster. Nothing here moves the tag. docs/spec/tamanu/renderer-rollout.md says what it must do.
#
# Environment, all optional:
#   ARGO_NAMESPACE  where Argo CD runs (argocd-system)
#   ARGO_PROJECT    the project whose Applications are refreshed (tamanu)
#   REPO_SERVER     the repo server Deployment (argo-cd-argocd-repo-server)
#   WAIT_MINUTES    how long to wait for the refreshed Applications to render (10)
set -euo pipefail

channel="${1:?usage: refresh-channel.sh <stable|canary>}"
ns="${ARGO_NAMESPACE:-argocd-system}"
project="${ARGO_PROJECT:-tamanu}"
server="${REPO_SERVER:-argo-cd-argocd-repo-server}"
wait_minutes="${WAIT_MINUTES:-10}"

# The plugin an Application names in `spec.source.plugin.name` to be rendered by the channel.
# Keep in step with pluginName() in pulumi/common/tamanuRenderer.ts, which a test checks.
case "$channel" in
  stable) plugin=infra-argo-tamanu-renderer-v1 ;;
  canary) plugin=infra-argo-tamanu-renderer-canary-v1 ;;
  *) echo "unknown channel '$channel', use stable or canary" >&2; exit 2 ;;
esac

# Allowance for this clock differing from the cluster's.
skew=15

# spec: TRO#promotion
# A refresh answered by the old repo server stores the old render again under the same cache
# key, so the new one has to be serving before anything is refreshed.
echo "Restarting $server in $ns"
kubectl -n "$ns" rollout restart "deploy/$server"
kubectl -n "$ns" rollout status "deploy/$server" --timeout="${wait_minutes}m"

# spec: TRO#promotion
# Only Applications rendered by this channel's plugin are refreshed. The others keep serving
# the render they have cached.
mapfile -t apps < <(
  kubectl -n "$ns" get applications.argoproj.io -o json |
    jq -r --arg project "$project" --arg plugin "$plugin" '
      .items[]
      | select(.spec.project == $project and .spec.source.plugin.name == $plugin)
      | .metadata.name'
)

if [ "${#apps[@]}" -eq 0 ]; then
  echo "No $project Applications are rendered by $plugin, so there is nothing to refresh"
  exit 0
fi

echo "Refreshing ${#apps[@]} Application(s) rendered by $plugin"
refresh_began=$(date -u +%s)
for app in "${apps[@]}"; do
  kubectl -n "$ns" annotate "applications.argoproj.io/$app" argocd.argoproj.io/refresh=hard --overwrite
done

# spec: TRO#promotion
# An Application is done once Argo CD has taken the annotation off and compared it again. It
# has failed if the comparison reported an error, or if a sync that ran since the refresh
# failed. Health is not waited for: a sync that runs migrations can outlast any wait.
deadline=$(( $(date -u +%s) + wait_minutes * 60 ))
names=$(printf '%s\n' "${apps[@]}" | jq -Rn '[inputs]')
while :; do
  # All of them are listed and filtered, since asking for one by name returns an object, not a list.
  report=$(
    kubectl -n "$ns" get applications.argoproj.io -o json |
      jq -r --argjson names "$names" --argjson began "$refresh_began" --argjson skew "$skew" '
        def ts: if . == null then 0 else (fromdateiso8601? // 0) end;
        .items[]
        | select(.metadata.name as $name | $names | index($name))
        | . as $app
        | ($app.status.conditions // [] | map(select(.type == "ComparisonError")) | first) as $comparison
        | ($app.status.operationState // {}) as $op
        | if ($app.metadata.annotations["argocd.argoproj.io/refresh"] != null)
              or (($app.status.reconciledAt | ts) < ($began - $skew))
          then "pending \($app.metadata.name)"
          elif $comparison != null
          then "failed \($app.metadata.name): render error: \($comparison.message)"
          elif ($op.phase == "Failed" or $op.phase == "Error") and (($op.finishedAt | ts) >= ($began - $skew))
          then "failed \($app.metadata.name): sync \($op.phase): \($op.message // "no message")"
          else "done \($app.metadata.name)"
          end'
  )

  if grep -q '^failed ' <<<"$report"; then
    grep '^failed ' <<<"$report" >&2
    echo "Promotion of $channel failed: the Applications above did not render cleanly" >&2
    exit 1
  fi
  if ! grep -q '^pending ' <<<"$report"; then
    echo "All ${#apps[@]} Application(s) rendered by $plugin have rendered again"
    exit 0
  fi
  if [ "$(date -u +%s)" -ge "$deadline" ]; then
    grep '^pending ' <<<"$report" >&2
    echo "Promotion of $channel failed: the Applications above had not rendered after ${wait_minutes} minutes" >&2
    exit 1
  fi
  sleep 5
done

# SOP: Inspect an Application

Read why a deployment's Argo CD Application is not Synced or Healthy, and what failed in its last sync.
All steps are **[diagnose]**.
Reading the Application with `kubectl` needs deployer access to `applications` in `argocd-system`; otherwise the Argo CD UI shows the same resource tree, waves and Jobs ([deployment context](../deployment-context.md#reading-the-state)).

```sh
# Sync and health
kubectl -n argocd-system get app tamanu-<stack>

# Why it is not Synced or Healthy
kubectl -n argocd-system get app tamanu-<stack> -o json \
  | jq '.status.conditions, .status.operationState.message,
        [.status.resources[] | select(.health.status != "Healthy" and .health.status != null)
         | {kind, name, status: .health.status, message: .health.message}]'

# What failed in the last sync
kubectl -n argocd-system get app tamanu-<stack> -o json \
  | jq '.status.operationState.syncResult.resources[] | select(.hookPhase == "Failed")'

# The Jobs, and a failed one's output
kubectl -n tamanu-<stack> get jobs
kubectl -n tamanu-<stack> logs job/central-migrator
```

Hook Jobs are deleted and created again on the next sync, so read a failed Job's logs before anything triggers one ([TDR](../spec/tamanu/deployment-rollout.md#hook-jobs)).
For anything else that is Degraded, `kubectl -n tamanu-<stack> describe <kind>/<name>` shows its events.

## Reading the output

| Where | Meaning |
|---|---|
| `status.conditions` with type `ComparisonError` | The render failed, so nothing is applied: [render error](../runbooks/render-error.md). |
| `status.operationState.phase` `Failed` or `Error` | A sync failed: [sync failed](../runbooks/argo-sync-failed.md). |
| Sync `Synced`, health `Progressing` | The sync finished but something is not ready: [stuck progressing](../runbooks/application-stuck-progressing.md). |
| Sync `OutOfSync` after a good sync | [Out of sync](../runbooks/application-out-of-sync.md). |
| A `Cluster` with health message `Hibernated` | The deployment is hibernated: [down but nothing failed](../runbooks/deployment-down-nothing-failed.md). |

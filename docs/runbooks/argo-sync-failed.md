# Runbook: `pulumi up` fails with "Argo CD sync Failed"

An update fails with `Argo CD sync Failed: ... retried 5 times` (or `Error`), or the Application shows a failed sync.
A wave did not complete, so nothing after it ran.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The Application has a sync operation in phase `Failed` or `Error`.
The stub fails the update for a sync that finished failing after the update began, and ignores one that finished before ([TDR](../spec/tamanu/deployment-rollout.md#update-completion)).
If the Application never settles instead, use [stuck progressing](application-stuck-progressing.md).

## 2. Establish context

Which deployment, which wave failed, what changed in this update (image tag, config key): [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **What is unhealthy and what failed in the last sync**, with the second and third commands of [inspect an Application](../sops/inspect-application.md). **[diagnose]**
2. **A failed Job's logs** before anything triggers another sync ([read logs](../sops/read-logs.md#hook-jobs)). **[diagnose, sensitive-data]**
3. **Anything else Degraded**: `kubectl -n tamanu-<stack> describe <kind>/<name>`. **[diagnose]**

## 4. Interpret

Waves are in [object names](../reference/tamanu-deployment-objects.md#rendered-objects-by-sync-wave): databases, then reporting grants and migrators, then the provisioner and setup-sync, then servers and routes ([TDR](../spec/tamanu/deployment-rollout.md#sync-order)).

| Evidence | Diagnosis | Action |
|---|---|---|
| A Job is `Failed` | A hook Job failed: [hook Job failed](hook-job-failed.md). | Follow that runbook. |
| A route is `Failed` with `service ... not found` | A route was applied before its Service. Every Service and route belongs in the last wave, so this is a renderer bug, not a cluster fault ([TDR](../spec/tamanu/deployment-rollout.md#sync-order)). | Escalate: `tamanu/on-k8s/renderer/src/waves.rs` and the route in `gateway.rs`. |
| A database `Cluster` is Progressing in wave 0 | The database is not ready: [database not coming up](database-not-coming-up.md). | Follow that runbook. |
| Pods in `ImagePullBackOff` | The image tag does not exist: [image tag missing](image-pull-backoff.md). | Follow that runbook. |
| Anything else Degraded | Depends on the object. | Read its events and escalate with them. |

## 5. Resolve

Once the cause is fixed the Application retries on its own, up to 5 times at growing intervals ([TDR](../spec/tamanu/deployment-rollout.md#application)).
Run the update again to have the stub wait on it ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.

## 6. Escalate

Escalate for a renderer bug, a failure with no clear object, or a cluster-level fault.
Give the deployment, the failed wave and object, its message, and the Job log lines (redacted).

# Runbook: Argo CD sync Failed, or Application stuck Progressing until `pulumi up` times out

An update fails with `Argo CD sync Failed: ... retried 5 times` (or `Error`), or the Application shows a failed sync.
Or the sync did not fail, but the Application never becomes Healthy, and `pulumi up` waits and then fails after `argoWaitMinutes` (30 by default) with `Application <name> was <sync>/<health> after N minutes`.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The Application has a sync operation in phase `Failed` or `Error`: a wave did not complete, so nothing after it ran.
The stub fails the update for a sync that finished failing after the update began, and ignores one that finished before ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#update-completion)).
Or the Application's health is `Progressing` or `Degraded` for a long time, or a wave waits on an object that neither completes nor fails.

## 2. Establish context

Which deployment, which wave failed or is waiting, and what changed in this update (image tag, config key): [deployment context](../deployment-context.md). **[diagnose]**
A hibernated deployment reports its database as Healthy, so it does not stick here ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#database-health)).

## 3. Investigate

1. **The sync phase, what is unhealthy, and what failed in the last sync**, with the commands of [inspect an Application](../sops/inspect-application.md). The first non-healthy object in the lowest wave is the blocker. **[diagnose]**
2. **A failed Job's logs** before anything triggers another sync ([read logs](../sops/read-logs.md#hook-jobs)). **[diagnose, sensitive-data]**
3. **Pods that cannot start**: `kubectl -n tamanu-<stack> get pods`, then `kubectl -n tamanu-<stack> describe pod <pod>` for events. **[diagnose]**
4. **Jobs that neither finish nor fail**: `kubectl -n tamanu-<stack> get jobs` and the pod of a hook Job. **[diagnose]**
5. **Anything else Degraded**: `kubectl -n tamanu-<stack> describe <kind>/<name>`. **[diagnose]**

## 4. Interpret

Waves are in [object names](../reference/tamanu-deployment-objects.md#rendered-objects-by-sync-wave): databases, then reporting grants and migrators, then the provisioner and setup-sync, then servers and routes ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#sync-order)).

| Evidence | Diagnosis | Action |
|---|---|---|
| Operation phase `Failed` or `Error` | A wave failed and nothing after it ran; the failed object is in the third command's output. | Find the failed object in the rows below. |
| Operation finished, health `Progressing` or `Degraded` | An object in the lowest unhealthy wave is not ready and has not failed either. | Find the blocking object in the rows below. |
| A Job is `Failed` | A hook Job failed: [hook Job failed](hook-job-failed.md). | Follow that runbook. |
| A route is `Failed` with `service ... not found` | A route was applied before its Service. Every Service and route belongs in the last wave, so this is a renderer bug, not a cluster fault ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#sync-order)). | Escalate: `tamanu/on-k8s/renderer/src/waves.rs` and the route in `gateway.rs`. |
| A database `Cluster` is Progressing | Argo CD reports a cluster Healthy only once its Ready condition is true, and wave 0 waits for it ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#database-health)). | [Database not coming up](database-not-coming-up.md). |
| Pods in `ImagePullBackOff` | The image tag does not exist. | [Image tag missing](image-pull-backoff.md). |
| A `*-reporting-grants` pod stays in `ContainerCreating` | It reads a Secret the database operator creates with the cluster, and a missing Secret means the pod never starts, so the Job neither completes nor fails. | Check the database first: `<server>-db-superuser` exists once its cluster is created ([object names](../reference/tamanu-deployment-objects.md#created-by-cloudnativepg)). |
| Pods `Pending` with a scheduling message | Servers need a node with `bes.node.purpose=workload` and the deployment's architecture, and replicas of a server must spread across nodes, so a pod that would break the spread stays unscheduled ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#placement)). | Read the pod's events. Capacity or architecture mismatches are a cluster matter: escalate. |
| A hook Job pod is running for a long time | The migrator or provisioner is working or waiting on the database. | Read its logs ([read logs](../sops/read-logs.md#hook-jobs)). **[diagnose, sensitive-data]** |
| A claim `<server>-blobs` is `Pending` | Shared blob storage cannot be provisioned. | Escalate: [K8SVOL](../spec/kubernetes/volumes.md) and the `efs` storage class. |
| Anything else Degraded | Depends on the object. | Read its events and escalate with them. |

## 5. Resolve

Fix the failed or blocking object through its runbook.
After a failed sync the Application retries on its own, a bounded number of times at growing intervals ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#application)); the limit is in `pulumi/tamanu/on-k8s/src/argo/application.ts`.
After a stuck one, Argo CD continues from the wave it was in.
Either way, run the update again to have the stub wait on it ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
Raising `argoWaitMinutes` only helps when the sync is genuinely slow, for example a long migration.

## 6. Escalate

Escalate for a renderer bug, a scheduling or storage fault, a failure with no clear object, or a cluster-level fault.
Give the deployment, the failed or blocking wave and object, its message and events, and the Job log lines (redacted).

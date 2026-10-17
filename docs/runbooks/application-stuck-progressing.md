# Runbook: Application stuck Progressing, or `pulumi up` times out

The sync did not fail, but the Application never becomes Healthy.
`pulumi up` waits and then fails after `argoWaitMinutes` (30 by default) with `Application <name> was <sync>/<health> after N minutes`.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The Application's health is `Progressing` or `Degraded` for a long time, or a wave waits on an object that neither completes nor fails.

## 2. Establish context

Which deployment, which wave it is waiting in, what changed: [deployment context](../deployment-context.md). **[diagnose]**
A hibernated deployment reports its database as Healthy, so it does not stick here ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#database-health)).

## 3. Investigate

1. **List what is not healthy** (the second command of [inspect an Application](../sops/inspect-application.md)). The first non-healthy object in the lowest wave is the blocker. **[diagnose]**
2. **Pods that cannot start**: `kubectl -n tamanu-<stack> get pods`, then `kubectl -n tamanu-<stack> describe pod <pod>` for events. **[diagnose]**
3. **Jobs that neither finish nor fail**: `kubectl -n tamanu-<stack> get jobs` and the pod of a hook Job. **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| A database `Cluster` is Progressing | Argo CD reports a cluster Healthy only once its Ready condition is true, and wave 0 waits for it ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#database-health)). | [Database not coming up](database-not-coming-up.md). |
| A Deployment's pods are in `ImagePullBackOff` | The image tag does not exist. | [Image tag missing](image-pull-backoff.md). |
| A `*-reporting-grants` pod stays in `ContainerCreating` | It reads a Secret the database operator creates with the cluster, and a missing Secret means the pod never starts, so the Job neither completes nor fails ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#sync-order)). | Check the database first: `<server>-db-superuser` exists once its cluster is created ([object names](../reference/tamanu-deployment-objects.md#created-by-cloudnativepg)). |
| Pods `Pending` with a scheduling message | Servers need a node with `bes.node.purpose=workload` and the deployment's architecture, and replicas of a server must spread across nodes, so a pod that would break the spread stays unscheduled ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#placement)). | Read the pod's events. Capacity or architecture mismatches are a cluster matter: escalate. |
| A hook Job pod is running for a long time | The migrator or provisioner is working or waiting on the database. | Read its logs ([read logs](../sops/read-logs.md#hook-jobs)). |
| A claim `<server>-blobs` is `Pending` | Shared blob storage cannot be provisioned. | Escalate: [K8SVOL](../spec/kubernetes/volumes.md) and the `efs` storage class. |

## 5. Resolve

Fix the blocking object through its runbook.
Argo CD then continues from the wave it was in; run the update again to have the stub wait on it ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
Raising `argoWaitMinutes` only helps when the sync is genuinely slow, for example a long migration.

## 6. Escalate

Escalate for scheduling or storage faults, or when nothing in the list matches.
Give the deployment, the blocking object and its events.

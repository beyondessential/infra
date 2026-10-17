# Runbook: a database does not come up

A server's CloudNativePG cluster (`central-db`, `facility-N-db`) is not Ready, so wave 0 never completes.
Argo CD reports a cluster Progressing until its Ready condition is true ([TDR](../spec/tamanu/deployment-rollout.md#database-health)).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
**Never delete a volume, snapshot or the `Cluster`**: [ruled-out actions](../ruled-out-actions.md#ruled-out-actions-never-suggest).

## 1. When this applies

An Application is Progressing with a `Cluster` as the blocker, a deployment's databases did not return after [waking](../sops/wake-deployment.md), or a migrator cannot connect.

## 2. Establish context

Which server's cluster, whether the deployment is hibernated, whether this is its first creation or an update, whether backups or a seed snapshot are involved: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

1. **The cluster's state**: `kubectl -n tamanu-<stack> get clusters.postgresql.cnpg.io` and `kubectl -n tamanu-<stack> describe cluster.postgresql.cnpg.io <server>-db`. **[diagnose]**
2. **Its pods and volumes**: `kubectl -n tamanu-<stack> get pods -l cnpg.io/cluster=<server>-db` then `describe pod <pod>`, and `kubectl -n tamanu-<stack> get pvc`. **[diagnose]**
3. **A database pod's log**: `kubectl -n tamanu-<stack> logs <pod>`. **[diagnose, sensitive-data]**
4. **If seeded**: whether the clone is ready, `kubectl -n tamanu-<stack> get volumesnapshot seed-snapshot` ([seeded deployments](seeded-deployment.md)). **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Annotation `cnpg.io/hibernation: "on"` | Hibernated, not broken. | [Down but nothing failed](deployment-down-nothing-failed.md). |
| Instance pods `Pending` with a scheduling message | Database pods need a node labelled `bes.node.purpose=workload` and `bes.node.arch=arm64`. With `capacity: ondemand` each instance needs its own on-demand node, and with `dbAzColocate` (the default) every instance of a cluster must share one availability zone ([TDR](../spec/tamanu/deployment-rollout.md#placement), `tamanu/on-k8s/renderer/src/postgres.rs`). | Read the scheduling message. A zone or capacity shortage is a cluster matter: escalate. Turning `dbAzColocate` off trades zone-failure tolerance for schedulability: a developer's decision **[dev-OTS]**. |
| A claim `Pending` | The volume cannot be provisioned or bound. | Escalate. Do not delete the claim. |
| Pods running, cluster not Ready | An instance is starting, restoring or catching up, or the primary is failing. | Read the pod logs. Give a restore from a seed snapshot time before judging it stuck. |
| `describe cluster` shows an update the operator refused | The operator rejects a single update that changes both the image and Postgres parameters, and a dependent of a refused cluster waits without end ([K8SPGC](../spec/kubernetes/postgres.md#scheduling-and-disruption)). | Escalate with the event text. |
| With `backupsEnabled`, events about the object store or role | The backup bucket or role is missing or wrong ([K8SBAK](../spec/kubernetes/database-backups.md)). | Escalate; do not touch the bucket. |

## 5. Resolve

Support's own steps end at diagnosis.
Restarting one instance with `kubectl cnpg destroy` is **[dev-OTS]** and recreates it from its replicas or backups: a developer decides.
Restoring from a backup over a live database is ruled out.

## 6. Escalate

Escalate for any scheduling, storage, operator or backup fault.
Give the deployment, the cluster name, `describe cluster` events, the pod events, and whether the deployment has backups or was seeded.

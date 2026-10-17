# Runbook: deployment is down but nothing failed

The addresses of a deployment do not respond and there are no pods, but no sync failed and no Job is red.
The usual cause is hibernation at the end of its time to live.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
Check [ruled-out actions](../ruled-out-actions.md) before running anything mutating.

## 1. When this applies

Use this when the Application is Synced and Healthy (or Healthy with a database message `Hibernated`) and the servers have zero replicas.
If a sync failed or the Application is Progressing, use [sync failed](argo-sync-failed.md) or [stuck progressing](application-stuck-progressing.md) instead.

## 2. Establish context

Which deployment, which cluster, whether it has a time to live: [deployment context](../deployment-context.md). **[diagnose]**
Pull request deployments get a short time to live from Tamanu CD, so this is the expected state of an idle one.

## 3. Investigate

1. **Hibernation state** of the databases and Deployments, with the commands in [deployment context](../deployment-context.md#hibernation-state). **[diagnose]**
2. **Whether a `wake` CronJob exists** in the namespace: `kubectl -n tamanu-<stack> get cronjob`. **[diagnose]**
3. **When it expired**, from the schedule of the `ttl-hibernate-*` CronJob (same section). **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Every Cluster `hibernation: "on"`, every Deployment `forced: "true"`, a `wake` CronJob exists | Hibernated at the end of its time to live. Expected ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#hibernation)). | [Wake it](../sops/wake-deployment.md), or update the stack to wake it and set a new expiry. |
| Deployments at zero replicas with no `force-downtime` annotation, Clusters not hibernated | Scaled down by hand, or the replica keys are `0`. Argo CD ignores replica counts, so it stays ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#ignored-differences)). | Check `*Replicas` in the [config](../reference/tamanu-deployment-config.md#replicas) and ask who scaled it. Scaling back is **[dev-OTS]**. |
| Only some objects carry the hibernation annotations | A hibernate or wake Job half-ran: its two steps are separate containers. | Wake it again; if the Job fails, escalate. |
| No `wake` CronJob and no `ttl-hibernate-*` | The deployment has no time to live ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#waking)). It is not hibernation. | Go to [stuck progressing](application-stuck-progressing.md) and [database not coming up](database-not-coming-up.md). |

## 5. Resolve

- **Wake without an update**: [wake a deployment](../sops/wake-deployment.md) **[approved-mitigation]**. It does not start a new time to live, so the deployment stays up until the next update.
- **Wake and reset the expiry**: update the stack, which wakes a deployment with a time to live every time ([change a deployment's config](../sops/change-deployment-config.md)) **[dev-OTS]**.
- **Keep it up for longer**: raise `ttlHours`, or set it to `0` for never, and update **[dev-OTS]**.

The expiry can run up to 20 minutes behind the configured hours, because hibernation runs on a 20 minute grid ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#time-to-live)).

## 6. Escalate

Escalate when the wake Job fails, when the deployment is woken and the databases do not come back (go to [database not coming up](database-not-coming-up.md) first), or when the deployment is long-lived and was hibernated unexpectedly.

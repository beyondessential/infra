# SOP: Wake a hibernated deployment

Reverse a hibernation without an update.
**[approved-mitigation]**: the spec lets a person do it, and the Argo CD default role grants the action to anyone who can reach the Argo CD server ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#waking), [K8SNSP](../spec/kubernetes/namespaces.md#argo-cd-access)).
It only applies to a deployment with a time to live, which is the only kind that has a `wake` CronJob.
Confirm first that the deployment is hibernated and not scaled down by hand: [down but nothing failed](../runbooks/deployment-down-nothing-failed.md).

Waking does not start a new time to live.
The deployment stays up until the next update, which also sets a new expiry.
To keep it up longer, raise `ttlHours` ([change a deployment's config](change-deployment-config.md)).

## Argo CD UI

1. Open the Application `tamanu-<stack>`.
2. Find the `wake` CronJob (search for `wake`, or filter by kind).
3. Run its "Create Job" action.

The CronJob is suspended, so it never runs except this way.

## Command line

```sh
kubectl -n tamanu-<stack> create job --from=cronjob/wake wake-now
```

The `tamanu-engineer` role cannot create Jobs, so an engineer without the on-call or deployer role uses the UI ([K8SNSP](../spec/kubernetes/namespaces.md#roles)).

## What the Job does

It runs as the `tamanu-ttl` service account.
It removes `downscaler/force-downtime` from every Deployment and sets `cnpg.io/hibernation=off` on every database cluster, then hard-refreshes the Application so the deployment renders with the current channel ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#waking)).
The databases start first and the servers after them.

## Check

```sh
kubectl -n tamanu-<stack> get jobs
kubectl -n tamanu-<stack> logs job/wake-now -c wake-deployments
kubectl -n tamanu-<stack> logs job/wake-now -c wake-cnpg
kubectl -n tamanu-<stack> get clusters.postgresql.cnpg.io
```

The Job has two containers, `wake-deployments` and `wake-cnpg`, and one can fail while the other succeeds.
Then check the state as in [deployment context](../deployment-context.md#hibernation-state).
If the Job fails, escalate: a failure here is a permissions or scheduling fault outside support's reach.

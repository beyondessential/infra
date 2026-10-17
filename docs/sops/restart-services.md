# SOP: Restart services

Restarting a server on Kubernetes is mutating, so it is **[dev-OTS]**.
No source pre-signs a restart here.
A runbook that wants one pre-signed must say so.

Know what it interrupts first.
The task runners, FHIR workers and the facility sync server are updated by recreation, which stops the old pod before starting the new one, so a restart means a gap with none running.
API servers and web frontends are rolling, so a restart replaces them one at a time ([TDR](../spec/tamanu/deployment-rollout.md#update-strategy)).
Deployment names are in [object names](../reference/tamanu-deployment-objects.md).

## Roll a Deployment

```sh
kubectl -n tamanu-<stack> rollout restart deploy/central-api
kubectl -n tamanu-<stack> rollout status deploy/central-api
```

## Restart one pod

The `tamanu-engineer` role can delete pods, and the Deployment starts a replacement:

```sh
kubectl -n tamanu-<stack> delete pod <pod>
```

Do not delete a database pod this way.
Use the [database runbook](../runbooks/database-not-coming-up.md), because a database instance is a different operation (`kubectl cnpg destroy` is dev-OTS, see [ruled-out actions](../ruled-out-actions.md#consequential-but-recoverable-dev-ots)).

## Scaling is not a restart

Argo CD ignores the replica count, so `kubectl scale` sticks across syncs until someone scales back or the next update.
A deployment scaled to zero by hand is not hibernated: [down but nothing failed](../runbooks/deployment-down-nothing-failed.md).

## The renderer

Restarting the Argo CD repo server affects every deployment on the cluster, so it is not a service restart.
It belongs to [hard-refresh an Application](hard-refresh-application.md) and [promote a renderer channel](promote-renderer-channel.md).

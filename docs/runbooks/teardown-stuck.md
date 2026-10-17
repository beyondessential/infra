# Runbook: teardown is stuck

Destroying a deployment hangs: the Application or the namespace will not go.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
**Only for a disposable deployment** (control `pr=<number>`). For any other deployment, stop and escalate: [ruled-out actions](../ruled-out-actions.md#ruled-out-actions-never-suggest).

## 1. When this applies

A destroy, or [Tamanu CD's down job](../sops/destroy-deployment.md), has run for a long time, or the namespace stays `Terminating`.

## 2. Establish context

Confirm the deployment is disposable: [deployment context](../deployment-context.md#origin). **[diagnose]**

## 3. Investigate

Destroying the stub deletes the Application, and its finalizer deletes everything it created before the namespace is removed ([TDR](../spec/tamanu/deployment-rollout.md#application)).
Find what is blocking: **[diagnose]**

```sh
kubectl -n argocd-system get app tamanu-<stack> -o json | jq '.metadata.deletionTimestamp, [.status.resources[] | {kind, name}]'
kubectl -n tamanu-<stack> get all
```

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Application has a `deletionTimestamp` and resources remain | Argo CD is still deleting. Volumes and database clusters can take a while. | Wait, then re-check. |
| One object does not go | A finalizer or a dependent holds it. | Name it and escalate. |
| Nothing left but the Application and the namespace | The finalizer is stuck. | Last resort below. |

## 5. Resolve

As a last resort, **[dev-OTS]**, and only after a developer confirms the deployment is disposable: delete the namespace's anchor in `tamanu-super`, which removes the namespace and everything in it, then remove the Application's finalizer:

```sh
kubectl -n tamanu-super delete subnamespaceanchor tamanu-<stack>
kubectl -n argocd-system patch app tamanu-<stack> --type merge -p '{"metadata":{"finalizers":null}}'
```

Tamanu CD's down job does the anchor delete itself on every run, and `scripts/tamanuStacks.fish --destroy --yes` deletes the namespace before destroying the stack ([destroy a deployment](../sops/destroy-deployment.md)).
A seeded deployment's cluster-scoped `VolumeSnapshotContent` is removed by `pulumi destroy`, not by the namespace delete ([seeded deployments](seeded-deployment.md)).
Both commands need the deployer group: only it may delete anchors and write Applications ([K8SNSP](../spec/kubernetes/namespaces.md#roles)).

## 6. Escalate

Escalate for anything not disposable, or when an object will not go after the steps above.
Give the blocking object, its finalizers and the namespace's status.

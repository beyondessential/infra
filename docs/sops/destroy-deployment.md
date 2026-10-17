# SOP: Destroy a deployment

Remove a deployment, its namespace and its data.
**[dev-OTS], and only for a disposable deployment** (control `pr=<number>`, [ruled-out actions](../ruled-out-actions.md#disposable-and-long-lived-deployments)).
Destroying a long-lived deployment is ruled out: escalate.
Destroying removes the database volumes with the namespace, so confirm the stack name twice.
Read any script before running it.

## The usual route

Tamanu CD does it when a pull request closes, when its deploy box is unticked, or when it goes stale ([`cd-down.yml`](https://github.com/beyondessential/tamanu/blob/main/.github/workflows/cd-down.yml) in the Tamanu repository).
It checks the `auto-deploy` ConfigMap belongs to the branch, runs `pulumi destroy` and removes the stack, then always deletes the SubnamespaceAnchor, and forgets the stack if the destroy failed.

Destroying the stub deletes the Application, and the Application's finalizer deletes everything it created before the namespace goes ([TDR](../spec/tamanu/deployment-rollout.md#application)).
The anchor delete removes the namespace and anything left in it ([K8SNSP](../spec/kubernetes/namespaces.md#deployment-namespaces)).

## By hand

From the repository, with `kubectl` on the deployment's cluster ([connect to the cluster](connect-to-k8s-cluster.md)):

```sh
pulumi/scripts/tamanuStacks.fish --destroy <stack>           # preview only
pulumi/scripts/tamanuStacks.fish --destroy --yes <stack>     # asks you to type "destroy"
```

The script deletes the namespace first, through its anchor if there is one, then destroys and removes the stack.
The namespace goes first because HNC recreates the namespace's hierarchy configuration as fast as Pulumi deletes it.
It also removes "ghost" stacks whose namespace is gone or empty, after a separate confirmation.

## Check

```sh
kubectl get namespace tamanu-<stack>
kubectl -n argocd-system get app tamanu-<stack>
```

Both should report not found.
A seeded deployment also has a cluster-scoped `VolumeSnapshotContent`, which `pulumi destroy` removes and a namespace delete alone does not ([seeded deployments](../runbooks/seeded-deployment.md)).
If it hangs, see [teardown stuck](../runbooks/teardown-stuck.md).

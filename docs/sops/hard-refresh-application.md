# SOP: Hard-refresh an Application

Make Argo CD discard the cached render of one Application and render it again.
**[dev-OTS]**: it can roll the deployment to a new render, and no source pre-signs it.
Use it when a renderer change was promoted but one Application still has the old render ([runbook](../runbooks/renderer-change-not-showing.md)).

**Never on a hibernated deployment.**
A sync of a hibernated deployment runs its hook Jobs against a database with no pods and fails.
[Waking it](wake-deployment.md) refreshes it ([TRO](../spec/tamanu/renderer-rollout.md#promotion)).

```sh
kubectl -n argocd-system annotate app tamanu-<stack> argocd.argoproj.io/refresh=hard --overwrite
```

This needs deployer access to `applications` in `argocd-system`.
Otherwise the Argo CD UI has the same refresh action under the Application's refresh menu ([K8SNSP](../spec/kubernetes/namespaces.md#argo-cd-access)).

If the repo server was only just updated and still serves the old plugin, restart it first.
That affects every Application on the cluster:

```sh
kubectl -n argocd-system rollout restart deploy/argo-cd-argocd-repo-server
```

To repeat the whole refresh for one channel on a cluster, `kubectl` pointing at it:

```sh
tamanu/on-k8s/renderer/tools/refresh-channel.sh stable   # or canary
```

The script restarts the repo server, waits for it, then hard-refreshes the awake Applications rendered by that channel.
It never moves the channel tag.
Afterwards check the [Application](inspect-application.md).

# SOP: Read logs

Read the logs of Tamanu servers, hook Jobs and the renderer.
Reading is **[diagnose]**.
Server logs are **[sensitive-data]**: request paths and errors can carry patient identifiers, so read in place, share only redacted lines, and never copy a raw log off the cluster ([ruled-out actions](../ruled-out-actions.md#sensitive-data-handling)).
Job and renderer logs hold little personal data, but a failed migration can echo a row.

Deployment names are in [object names](../reference/tamanu-deployment-objects.md).

## Tamanu servers

```sh
kubectl -n tamanu-<stack> logs deploy/central-api
kubectl -n tamanu-<stack> logs -f deploy/facility-1-sync
```

`deploy/<name>` reads one pod of the Deployment.
Name a pod (`kubectl -n tamanu-<stack> get pods`, then `logs <pod>`) to read a specific replica.
The Tamanu pack's [read-logs](https://github.com/beyondessential/tamanu/blob/main/docs/sops/read-logs.md) covers the other platforms.

### Caddy access log

On a Linux server Caddy logs JSON lines to the journal, access entries and runtime events together. **[diagnose]**
This keeps the runtime events, where certificate renewal failures appear, and drops the access entries, which carry a `status`:

```sh
journalctl -u caddy -o cat | jq -Rr 'fromjson? | select(.status == null) | [(.ts|todate), .level, .logger, .msg] | @tsv'
```

Leave out the `select` to read the access entries too; they are **[sensitive-data]** like any server log.

## Hook Jobs

```sh
kubectl -n tamanu-<stack> get jobs
kubectl -n tamanu-<stack> logs job/central-migrator
```

Hook Jobs are deleted and created again on every sync, so read them before triggering another ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#hook-jobs)).
The Jobs are `<server>-quiesce`, `<server>-reporting-grants`, `<server>-migrator`, `central-provisioner`, `facility-N-setup-sync` and `<server>-resume`.
`<server>-quiesce` logs the pending migrations that `just-migrate list --check` found before it stops the servers.

## The renderer

The renderer runs as a sidecar of the Argo CD repo server, one container per channel: `infra-argo-tamanu-renderer` for `stable` and `infra-argo-tamanu-renderer-canary` for `canary`.

```sh
kubectl -n argocd-system get pods -l app.kubernetes.io/component=repo-server
kubectl -n argocd-system logs deploy/argo-cd-argocd-repo-server -c infra-argo-tamanu-renderer
```

The `stable` sidecar logs `ignoring unknown config key(s)` when a deployment sends a key it does not know.
Reading the repo server's logs needs pod access in `argocd-system`, which the on-call role has cluster-wide and the engineer role does not ([K8SNSP](../spec/kubernetes/namespaces.md#roles)).

## Times

Pod logs are in UTC.
Convert with the deployment's `timezone` before deciding whether an event lines up with a working day ([deployment context](https://github.com/beyondessential/tamanu/blob/main/docs/deployment-context.md)).

# Tamanu on Kubernetes: support notes

How a Tamanu deployment is made and run with Argo CD, and what to check when it misbehaves. This covers the Argo CD based deployment only.

Commands use `<stack>` for the deployment's stack name and `tamanu-<stack>` for its namespace, which is also the name of its Argo CD Application. Argo CD runs in `argocd-system` unless the cluster sets `argoNamespace`.

## How a deployment is made

### The pieces

| Piece | Lives in | Does |
| --- | --- | --- |
| Tamanu CD | the Tamanu repository | Builds images, writes the stack's config, runs `pulumi up` and `pulumi destroy`. |
| The stub | the ops repository, `pulumi/tamanu/on-k8s` | A small Pulumi program, about 40 resources, that creates what cannot be rendered and the Argo CD Application. |
| The Application | `argocd-system` | One per deployment. Carries the render parameters and tells Argo CD to apply the result. |
| The renderer | this directory, `renderer/` | A binary that turns the parameters into every Kubernetes object of the deployment. It runs as an Argo CD config management plugin in a sidecar of the repo server. |
| Argo CD | `argocd-system` | Applies what the renderer produces, in order, and keeps it applied. |

The renderer is pure: the same parameters and the same renderer image always give the same objects. Anything that needs the live cluster, the clock, or random values is resolved by the stub and passed in.

### What the stub creates

- The namespace's schedule annotations, and the TTL hibernation machinery when `ttlHours` is set.
- The crypto Secret `tamanu-crypto`, and copies of the Secrets kept in `tamanu-system`.
- The password Secrets for the reporting roles, `<server>-raw-db` and `<server>-reporting-db`, and the auth secrets in `config-secrets-<server>`. The renderer refers to these by name and never sees their values.
- For a seeded deployment, a clone of the seed snapshot (see below).
- The Application.

`<server>` is `central` or `facility-N`.

### What happens on a deploy

1. Tamanu CD writes the stack config from the pull request or branch options, then runs `pulumi up`.
2. The stub updates the Application. Its `PARAMS` value is the stack config, the image tag, the Tamanu version and some facts about the cluster, as one JSON document.
3. Argo CD asks the plugin to render, and compares the result with the cluster.
4. Argo CD syncs in waves (below). Each wave starts only when the previous one is healthy.
5. The stub waits for the Application to be Synced and Healthy, and fails the `up` if a sync fails or it takes longer than `argoWaitMinutes` (30 by default).

### Renderer channels

The renderer image is published under two tags, `canary` and `stable`, and the repo server runs a plugin for each from the same image. A deployment is rendered by one of them: `stable` unless its stack config sets `rendererChannel` to `canary` (Tamanu CD sets it from the `channel` option). Applications from before channels existed are rendered by `stable`.

Every build of the renderer from `main` is promoted to `canary` by its CD. `stable` moves when someone runs the `infra-argo-tamanu-renderer promote` workflow with the commit to promote. Either way the promotion restarts the repo server on each cluster, waits for it, then hard-refreshes the Applications rendered by that channel, so the change shows up without anyone touching Argo CD. Applications on the other channel are left alone.

To try a renderer change on a deployment, give it the `canary` channel and redeploy. To go back, redeploy without the option; the Application is rendered by `stable` again without a refresh.

### Sync order

| Wave | Contents |
| --- | --- |
| 0 | Config ConfigMaps, the service account, the database clusters. |
| 1 | `<server>-reporting-grants` and `<server>-migrator` Jobs. |
| 2 | `central-provisioner` and `facility-N-setup-sync` Jobs. |
| 3 | Deployments, Services, Gateways and routes, disruption budgets, the seed top-up Job, the synthetic tests Deployment. |

The Jobs in waves 1 and 2 are Argo CD hooks. They are deleted and created again on every sync, including a sync where nothing about the image changed, so they must be safe to repeat. The Tamanu ones are.

### What is owned by whom

- Everything Argo CD applies carries the annotation `argocd.argoproj.io/tracking-id`.
- The config ConfigMaps `config-central`, `config-facility-N` and `provisioning` are created once from the exported templates. After that, Argo CD ignores their contents, so edits made by hand survive every sync.
- Replica counts and the downscaler and hibernation annotations are ignored too, since other things change them.
- The database credentials the servers use come from the `<server>-db-app` Secret that CNPG creates, key `uri`.

## Looking at a deployment

```sh
# The Application, its sync and health
kubectl -n argocd-system get app tamanu-<stack>

# Why it is not Synced or Healthy
kubectl -n argocd-system get app tamanu-<stack> -o json \
  | jq '.status.conditions, .status.operationState.message,
        [.status.resources[] | select(.health.status != "Healthy" and .health.status != null)
         | {kind, name, status: .health.status, message: .health.message}]'

# What failed in the last sync
kubectl -n argocd-system get app tamanu-<stack> -o json \
  | jq '.status.operationState.syncResult.resources[] | select(.hookPhase == "Failed")'

# The Jobs, and a failed one's output
kubectl -n tamanu-<stack> get jobs
kubectl -n tamanu-<stack> logs job/central-migrator

# The parameters the renderer was given, and the render for them
kubectl -n argocd-system get app tamanu-<stack> -o json \
  | jq -r '.spec.source.plugin.env[0].value' > params.json
infra-argo-tamanu-renderer --params params.json --format yaml | less
```

Argo CD's own UI shows the same tree, the waves and each Job. Reach it as set up for the cluster.

Each Application carries the labels `bes.tamanu/app-version`, `bes.tamanu/renderer-channel` (`stable` or `canary`) and `bes.tamanu/template` (the config template: `pr`, `rc`, `basic` or `demo`), which the UI can filter and group by and `kubectl -n argocd-system get app -l bes.tamanu/template=demo` can select. It also carries a link to each of the deployment's addresses.

## Common problems

### `pulumi up` fails with "Argo CD sync Failed ... retried 5 times"

A wave did not complete, so everything after it never ran. Find what is unhealthy with the second command above, or the failed hook with the third.

- A Job failed: read its logs. A failed migrator usually means a database or version problem, and the provisioner needs the migrator to have finished.
- A route is `Failed` with "service ... not found": a route was applied before the Service it points at. Every Service and route belongs in the last wave, so this means a renderer bug, not a cluster problem.
- Anything else Degraded: look at the object itself with `kubectl describe`.

Once the cause is fixed, the Application retries on its own. Run the `up` again to have the stub wait on it.

### `pulumi up` waits and then fails after 30 minutes

The sync worked but the Application never became Healthy. The `status.resources` query above lists what is not. The usual cause is a Deployment whose pods cannot start (see below). The wait is `argoWaitMinutes`.

### The Application shows a ComparisonError

The render failed, so nothing is applied. Read `status.conditions` for the message.

- "app path does not exist": the Application's source path is not in the pinned revision. The stub sets both, so this is a stub problem.
- "plugin ... not found" or the plugin never responding: the renderer sidecar on the repo server is not running or is the wrong version. Check the pod's containers and the sidecar's log:
  ```sh
  kubectl -n argocd-system get pods -l app.kubernetes.io/component=repo-server
  kubectl -n argocd-system logs deploy/argo-cd-argocd-repo-server -c infra-argo-tamanu-renderer
  ```
- A message naming a config key: the `canary` renderer rejects keys it does not know (`stable` ignores them and logs `ignoring unknown config key(s)` in its sidecar), and both reject secret values in stack config. Fix or remove the key, or add support for it in `src/params.rs`.
- Any other message: run the renderer by hand with the parameters from the Application, as above. It reports the same error.

### A renderer change does not show up

The render is cached by Argo CD on the source revision and the parameters. The Application's revision is pinned, so a new renderer image gives the same cache key and the old render is kept. Promoting the channel clears this for every Application on it. If the change was promoted and one Application still has the old render, look at the promotion run: it fails when a cluster was not reached, and names it.

To repeat the refresh for a cluster by hand, with `kubectl` pointing at it:

```sh
tamanu/on-k8s/renderer/tools/refresh-channel.sh stable   # or canary
```

For a single Application:

```sh
kubectl -n argocd-system annotate app tamanu-<stack> argocd.argoproj.io/refresh=hard --overwrite
```

If the repo server was only just updated and still serves the old plugin, restart it first:

```sh
kubectl -n argocd-system rollout restart deploy/argo-cd-argocd-repo-server
```

### The Application stays OutOfSync after a successful sync

The API server and webhooks fill in default fields that the render does not set, and a plain diff reports them as drift. Applications are created with `argocd.argoproj.io/compare-options: ServerSideDiff=true`, which accounts for them. If an Application lacks it, add it. If one still shows a difference with it, compare the live object with the render and look at the field named.

### Pods stuck in ImagePullBackOff

The image tag does not exist. Tamanu CD builds the central, facility, frontend and patient portal images for every pull request, but the synthetic tests image only for `main` and release branches. A pull request deployment with the artillery option fails here, and the Application stays Degraded until the option is removed or the Deployment is scaled to zero. Replica counts are ignored, so a scale-down stays.

### A Job failed

Hook Jobs are replaced on the next sync, so read the logs before anything triggers one.

- `central-migrator` or `facility-N-migrator`: the database could not be migrated. Check that its cluster is healthy and that the image version matches the data.
- `central-provisioner`: reads the `provisioning` ConfigMap. A hand edit that broke it shows here.
- `facility-N-setup-sync`: only runs when the Tamanu version is known and recent enough to have the command. Without a version in the stack config it is omitted.

### The deployment is down but nothing failed

With `ttlHours` set, a schedule scales the workloads to zero and hibernates the databases once the time is up. Every `pulumi up` sets a new expiry and wakes it, so a push to the branch brings it back. Argo CD ignores the annotations that do this.

To wake one without an update, open its Application in the Argo CD UI, find the `wake` CronJob (search for `wake`, or filter by kind), and run its "Create Job" action. The CronJob is suspended and only ever runs this way. It does not start a new time to live, so the deployment then stays up until the next update. From the command line, `kubectl -n tamanu-<stack> create job --from=cronjob/wake wake-now` does the same.

### Teardown is stuck

Destroying the stub deletes the Application, which deletes everything it created before the namespace is removed. If it hangs, find what is blocking:

```sh
kubectl -n argocd-system get app tamanu-<stack> -o json | jq '.metadata.deletionTimestamp, [.status.resources[] | {kind, name}]'
kubectl -n tamanu-<stack> get all
```

Volumes and database clusters can take a while. As a last resort, delete the namespace's anchor in `tamanu-super`, which removes the namespace and everything in it, then remove the Application's finalizer:

```sh
kubectl -n argocd-system patch app tamanu-<stack> --type merge -p '{"metadata":{"finalizers":null}}'
```

### Seeded deployments

A deployment can start from a seed snapshot instead of an empty database.

- No snapshot found: the stub logs a warning and the deployment starts with an empty database.
- Version: a snapshot with the deployment's major and minor version is preferred, otherwise the newest is used and the migrator brings it forward. Release rehearsals use the newest snapshot from before their minor version, so that their migrations run.
- "seedSnapshot writes fake clinical data": the stack's `nodeEnv` is production. Seeding is refused.
- The central database is restored from the snapshot only when its cluster is first created. Changing the snapshot later does not change an existing database.
- The top-up Job `central-seed-top-up-<hash>` adds fake data with `generate seed`. It runs once per image: the name comes from the image tag, so a new image runs it again, and the old Job is pruned. It adds records on every run, so it must not be forced to run again by hand.
- The seed clone includes a cluster-scoped `VolumeSnapshotContent`, which a namespace delete does not remove. A `pulumi destroy` does.

### Editing or resetting config

The config ConfigMaps can be edited with `kubectl edit`. Argo CD leaves the contents alone. To go back to the rendered default, delete the ConfigMap. Argo CD creates it again from the render on its next sync.

### Auth secrets

The auth secrets in `config-secrets-<server>` are created once and kept in Pulumi state. Changing or recreating them signs everyone out, since sessions and refresh tokens are signed with them.

### The program refuses because Argo CD is not installed

The error names the namespace and says Argo CD is not installed on the cluster it runs on. Nothing was changed. Install Argo CD, the renderer plugin and the `tamanu` project on that cluster first.

### A deployment from the previous program is refused

The error says the namespace "is not marked for the move to Argo CD". A deployment made by the previous Pulumi program is handed over to Argo CD in two steps, and the first has not been run for this one. The error names the ops ref and the line to add to run it. After that step, run the normal deploy again.

The handover replaces the Deployments, Gateways, routes and ConfigMaps that Pulumi named itself, and keeps the databases, volumes and most Services. It briefly takes the servers down. The config ConfigMaps are copied across first, so edits are kept, but the auth secrets are new and everyone is signed out. Each Gateway's Certificate is deleted with it, and the TLS Secret with the issued certificate is kept, so the new Gateway's Certificate finds it and no new certificate is ordered. If one is ordered anyway, it is a renewal for the same hostnames.

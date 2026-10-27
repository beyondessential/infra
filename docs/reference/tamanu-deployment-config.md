# Reference: Tamanu deployment stack config

Every config key of a Tamanu deployment on Kubernetes, with its default and meaning.
This is lookup material: for changing a key see [change a deployment's config](../sops/change-deployment-config.md).

The code is the authority, and this table was checked against it:

- `pulumi/tamanu/on-k8s/src/config.ts`, `version.ts`, `namespace.ts` and `argo/` (the stub).
- `tamanu/on-k8s/renderer/src/params.rs` (which keys exist and how they parse) and `config.rs` (defaults, clamps and refusals).

Keys live under the `tamanu-on-k8s:` namespace, and Pulumi stores every value as a string.
The string `null` means unset, as Tamanu CD writes an unset option.
Numbers, booleans and lists are parsed from their string form.
`billing:stage` is the one key outside the namespace.

## Rules that apply to every key

- The stub passes every key in the namespace to the renderer, except the stub-only keys below.
- The renderer refuses a key it does not know on the `canary` channel and ignores it, logging `ignoring unknown config key(s)`, on `stable` ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#parameters)).
- The stub refuses a secret value in the namespace, because the Application, and so the value, is readable in the cluster.
- `ipAllowList` is accepted and does nothing.

## Required

| Key | Meaning |
|---|---|
| `imageTag` | Tag of the Tamanu images, pulled from `ghcr.io/beyondessential/tamanu-central`, `tamanu-facility`, `tamanu-frontend` and `tamanu-patient-portal`, plus `tamanu-synthetic-tests` when `syntheticTests` is on. |
| `k8s-core` | The cluster stack the deployment runs on, `bes/k8s-core/<cluster-stack>`. The stub refuses to run against any other cluster. |

## Identity and addresses

| Key | Default | Meaning |
|---|---|---|
| `appVersion` | read from the image | Tamanu version. When unset the stub reads the version label of `beyondessential/tamanu-central:<imageTag>` and fails if there is none or it is not valid semver. It gates [version-dependent steps](../spec/kubernetes/tamanu/deployment-rollout.md#version-gated-steps) and is never inferred from the tag. |
| `namespace` | `tamanu-<stack>` | Namespace name. The stack name is lowercased, runs of other characters become `-`, trailing `-` is dropped, it is cut to 56 characters and edge `-` is dropped. An explicit value is used as given. Refused if it is exactly `system` or `super`. |
| `externalNamespace` | `false` | Stub only. `true` means the namespace already exists (Tamanu CD creates it through a SubnamespaceAnchor) and the stack only references it. `false` makes the stack create it and parent it to `tamanu-super`. |
| `domainBase` | see meaning | Base for every address. Default `<stack>.cd.tamanu.app`, or `<stack without -demo>.demos.tamanu.app` on a demo cluster (one whose DNS zones include `demos.tamanu.app` or whose name contains `demo`). The stack part is cut when it is 64 characters or more. Addresses are `central.<base>`, `<facility host>.<base>`, `portal.<base>`. |
| `facilities` | `2` | Number of facility servers. |
| `facilityNames` | `[]` | JSON list of facility entries, each a name or `{"id": ..., "host": ...}`. More entries than `facilities` is refused, and the rest are filled as `facility-N`, counting after the named ones. A bare name is lowercased for both id and host. An object keeps the case of `id` and lowercases `host`, which defaults to `id`. Ids must be unique, and so must hosts. The id is the facility id in the database and the facility server's device id, the host is its subdomain. |
| `redirects` | `{}` | JSON map of hostname to URL, for hostnames that only redirect. A target must be a URL with a hostname and no path. Rendered as a `redirects` Gateway and one HTTPRoute per hostname. |
| `configTemplate` | `basic` | Config template bundle: `basic`, `demo`, `legacy`, `nofeatures`, `pr` or `rc`, all built into the renderer image. A name with no file for a given config falls back to `basic` without an error, so a mistyped name renders as `basic`. `rc` also makes a seeded deployment start from the previous minor's snapshot. |
| `timezone` | `Pacific/Auckland` | `TZ` and `TAMANU_PRIMARY_TIMEZONE` of the central and facility servers, and `TZ` of the database pods. |
| `nodeEnv` | `production` | `NODE_ENV` of the servers. Tamanu CD sets `staging` unless told otherwise. |
| `serviceAccount` | unset | IAM role ARN. When set the renderer creates the `app-sa` service account annotated with it. |
| `localSecrets` | `[]` | Stub only. JSON list of names of `tamanu-system` Secrets the deployment keeps its own copy of. The stub does not copy them, and the copy in the namespace, set by hand, stays as it is. |

## Placement

| Key | Default | Meaning |
|---|---|---|
| `architecture` | `arm64` | `arm64` or `amd64`, anything else is refused. Applies to server pods. Database pods are always arm64. |
| `capacity` | `spot` | `spot` or `ondemand`, anything else is refused. `ondemand` keeps servers and databases off spot nodes ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#placement)). |

## Replicas

The per-server key wins over the generic one.
A value outside its range is raised or lowered to the range, never refused ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#replicas)).

| Keys | Default | Range |
|---|---|---|
| `centralApiReplicas`, `facilityApiReplicas`, else `apiReplicas` | 2 | 0 to 5 |
| `centralDbReplicas`, `facilityDbReplicas`, else `dbReplicas` | 2 | 2 to 3 |
| `centralTasksReplicas`, `facilityTasksReplicas`, else `tasksReplicas` | 1 | 0 to 1 |
| `centralWebReplicas`, `facilityWebReplicas`, else `webReplicas` | 2 | 0 to 5 |
| `patientPortalReplicas` | 2 | none |

The task count also sets the FHIR workers of the server.
A facility's sync server always has one replica.
Tamanu CD writes all of these from its own options, so a pull request deployment carries Tamanu CD's defaults, not these.

## Database

| Key | Default | Meaning |
|---|---|---|
| `dbStorage` | `5Gi` | Volume size of each database cluster, central and every facility. Any Kubernetes quantity, and the size feeds the Postgres tuning. A value that does not parse fails the render. |
| `dbMemory` | `750Mi`, `512Mi` on a demo cluster | Memory request of the database pods, which the memory parameters are derived from ([K8SPGC](../spec/kubernetes/postgres.md#tuning-basis)). |
| `dbExpose` | `true` | Central only: a Tailscale LoadBalancer Service `central-db-tailscale`, tailnet hostname `k8s-pg-<stack>`, so engineers can reach the primary directly. |
| `dbAzColocate` | `true` | Keeps all instances of one cluster in a single availability zone. |
| `dbDisruptionBudgets` | `false` | Keeps CloudNativePG's disruption budgets, which stop a node holding a primary from being drained. |
| `sharedBlobStorage` | `false` | Puts the blob store on a shared `efs` claim `<server>-blobs` instead of each pod's own disk. |

## Backups

| Key | Default | Meaning |
|---|---|---|
| `backupsEnabled` | `false` | WAL archiving and a daily base backup for every database cluster ([K8SBAK](../spec/kubernetes/database-backups.md#deployment-parameters)). Fails the render if no bucket is available. |
| `backupRetentionDays` | `3` | Days in the recovery window. |
| `barmanBucket` | the cluster's backup bucket | Bucket to archive to, written under `s3://<bucket>/<stack>/<cluster>/`. |
| `barmanRoleArn` | the cluster's backup role | Role the database pods assume. |

## Testing and seeding

| Key | Default | Meaning |
|---|---|---|
| `syntheticTests` | `false` | Runs the synthetic tests Deployment (one replica) and marks the servers to serve its random-record API. The image is built only for `main` and release branches. |
| `seedSnapshot` | `false` | Restores the central database from a seed snapshot when its cluster is first created, then tops it up with generated data after each new image (Tamanu 2.65.0 or later). Refused when `nodeEnv` is `production`. See [seeded deployments](../runbooks/seeded-deployment.md). |

## Lifetime and billing

| Key | Default | Meaning |
|---|---|---|
| `ttlHours` | `0` | Hours the deployment stays up after its latest update, a non-negative whole number or the stub refuses it. `0` means never hibernated. Also decides whether a `wake` CronJob is rendered ([K8STSD](../spec/kubernetes/tamanu/scaledown.md#time-to-live)). |
| `deployment` | `engineering` | Stub only. Cost-allocation label `billing.deployment`. |
| `billing:stage` | `test` | Cost-allocation label `billing.stage`. |

## Argo CD and renderer plumbing (stub only)

These are never sent to the renderer.
Set `argoNamespace` in every stack that uses it, because the cluster stacks read it too.

| Key | Default | Meaning |
|---|---|---|
| `argoNamespace` | `argocd-system` | Where Argo CD runs. |
| `argoProject` | `tamanu` | Argo CD project of the Application. |
| `argoWaitMinutes` | `30` | How long an update waits for the Application to be Synced and Healthy before failing ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#update-completion)). |
| `rendererChannel` | `stable` | `stable` or `canary`. Unset or `null` is `stable`, and any other value is refused ([K8STRO](../spec/kubernetes/tamanu/renderer-rollout.md#channels)). Tamanu CD sets it from its `channel` option. |
| `rendererRepo` | `https://github.com/beyondessential/infra` | Source repository of the Application. The project accepts only this one ([K8SNSP](../spec/kubernetes/namespaces.md#argo-cd-access)). |
| `rendererPath` | `.` | Path in that repository. The render does not depend on it. |

## Setting keys

`pulumi config set` and the project directory are in [change a deployment's config](../sops/change-deployment-config.md).
For a list value, give the JSON as the string:

```sh
pulumi config set -s <stack> facilityNames '["kule", {"id": "Bravo", "host": "bravo"}]'
```

A long-lived deployment usually sets `k8s-core`, `imageTag`, `configTemplate`, `timezone`, `nodeEnv`, `ttlHours`, `dbStorage`, `facilities`, `backupsEnabled` and `backupRetentionDays`, and leaves the rest at their defaults.
A pull request deployment has them written by Tamanu CD from its `%` options (see `configMap()` in `packages/scripts/src/ghaCdHelpers.mjs` in the Tamanu repository).

# Reference: objects of a Tamanu deployment

What exists in the namespace `tamanu-<stack>` and who owns it, so a runbook can name the right object.
`<server>` is `central` or `facility-N`, where N counts the facilities from 1 whatever their ids or hosts are.
The code is the authority: `tamanu/on-k8s/renderer/src/` (names in `names.rs`, waves in `waves.rs`) and `pulumi/tamanu/on-k8s/src/`.

## Owners

- **The renderer** produces everything in the sync-wave table below, and Argo CD applies it ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#sync-order)).
- **The stub** (the Pulumi program) creates what cannot be rendered: Secret values, anything that needs the live cluster or clock, and the Application.
- **CloudNativePG** creates the database pods and the database Secrets and Services.
- Everything Argo CD applies carries the annotation `argocd.argoproj.io/tracking-id`.

## Rendered objects by sync wave

A wave starts only when the previous one is synced and healthy.

| Wave | Objects |
|---|---|
| 0 | ConfigMaps `provisioning`, `config-central`, `config-facility-N`. ServiceAccount `app-sa` (with `serviceAccount`). Claim `<server>-blobs` (with `sharedBlobStorage`). Database `Cluster` `<server>-db`, and with backups its `ObjectStore` `<server>-db-object-store` and `ScheduledBackup` `<server>-db-scheduled`. |
| 1 | Hook Jobs `<server>-reporting-grants` and `<server>-migrator`. |
| 2 | Hook Jobs `central-provisioner` and `facility-N-setup-sync` (Tamanu 2.60.0 or later). |
| 3 | Deployments, Services, Gateways, HTTPRoutes, ClientTrafficPolicies and PodDisruptionBudgets (below). Service `central-db-tailscale` (with `dbExpose`). Job `central-seed-top-up-<hash>` (with `seedSnapshot`, 2.65.0 or later). Deployment `synthetic-tests` (with `syntheticTests`). CronJob `wake` (with `ttlHours`). Gateway `redirects` and its routes (with `redirects`). |

The hook Jobs are deleted and created again on every sync, so read a failed one's logs before anything triggers another sync ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#hook-jobs)).

## Workloads (wave 3)

| Deployment | Update | Notes |
|---|---|---|
| `central-api`, `central-web` | rolling | Replicated, with a Service and PodDisruptionBudget of the same name. |
| `central-tasks`, `central-fhir-refresh`, `central-fhir-resolver` | recreate | One replica. Zero when `*TasksReplicas` is zero. |
| `facility-N-api`, `facility-N-web` | rolling | Replicated. |
| `facility-N-sync` | recreate | Always one replica. |
| `facility-N-tasks` | recreate | None when the facility task count is zero. |
| `facility-refresh-fhir-<id>`, `facility-resolver-fhir-<id>` | recreate | `<id>` is the lowercased facility id, not `N`. Tamanu 2.60.0 or later, and only with tasks. |
| `patient-portal-web` | rolling | Replicated. |

Gateways are named `central`, `facility-N` and `patient-portal`, each with a `<name>-traffic-policy`.
The central API has the routes `central-api`, `central-api-legacy`, `central-api-import` and `central-api-import-legacy`, and the frontend route is `central-frontend`.
Update strategy and replica rules are in [K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#update-strategy).

## Created by the stub

| Object | Purpose | If it changes |
|---|---|---|
| Secret `tamanu-crypto` | Key file and encrypted settings key the servers use. | [Ruled out](../ruled-out-actions.md#ruled-out-actions-never-suggest). |
| Secrets `config-secrets-<server>` | Signing secrets for auth tokens (`authSecret`, and `authRefreshSecret` for central). Created once, kept in Pulumi state. | Recreating them signs every user out. |
| Secrets `<server>-raw-db`, `<server>-reporting-db` | Passwords of the legacy `raw` and `reporting` roles. Only before Tamanu 2.60.0, which manages its own roles. | |
| Secrets copied from `tamanu-system` | Shared integration credentials, copied on every update. | Rotate in `tamanu-system`, then update the stack. |
| `VolumeSnapshot seed-snapshot` and a cluster-scoped `VolumeSnapshotContent` | Clone of the seed snapshot (seeded deployments only). | A namespace delete leaves the content behind, `pulumi destroy` removes it. |
| ServiceAccount, Role and RoleBinding `tamanu-ttl`, CronJob `ttl-hibernate-*`, Job `ttl-wake-*` | Hibernation and waking (with `ttlHours`). | [K8STSD](../spec/kubernetes/tamanu/scaledown.md#hibernation) |
| Application `tamanu-<stack>` in `argocd-system` | Carries the render parameters. | |

The Application ignores the replica count and the hibernation annotations of Deployments, the `cnpg.io/hibernation` annotation of database clusters, and the contents of the three config ConfigMaps ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#ignored-differences)).

## Created by CloudNativePG

| Object | Purpose |
|---|---|
| Pods `<server>-db-<n>` | Database instances. The primary has the label `cnpg.io/instanceRole=primary`, and all carry `cnpg.io/cluster=<server>-db`. |
| Secret `<server>-db-app` | Credentials of the `app` role. Its `uri` key is the connection string the servers use. |
| Secret `<server>-db-superuser` | Superuser password. The `*-reporting-grants` Job reads it. |
| Service `<server>-db-rw` | Read-write service in front of the primary. |

The Tamanu database is `app`.

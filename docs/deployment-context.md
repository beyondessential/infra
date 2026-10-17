# Establishing deployment context on Kubernetes

Before investigating, work out which Tamanu deployment is affected and what state it is in.
This file covers deployments run on the Kubernetes clusters by Argo CD.
For the Canopy side (servers, health checks, notes, local time) use the Tamanu pack's [deployment context](https://github.com/beyondessential/tamanu/blob/main/docs/deployment-context.md), which this file does not repeat.

All steps are **[diagnose]** unless noted.
Commands use `<stack>` for the deployment's Pulumi stack name and `tamanu-<stack>` for its namespace.
`<cluster-stack>` is the name of the cluster's `k8s-core` stack, such as `tamanu-internal-main`, which the cluster pages call `<stack>` ([placeholders](reference/k8s-what-lives-where.md#names-used-in-the-cluster-pages)).

## Names

| What | Rule | Source |
|---|---|---|
| Pulumi stack | `bes/tamanu-on-k8s/<stack>`, one per deployment. Tamanu CD derives `<stack>` from the branch, pull request or demo name. | `pulumi/tamanu/on-k8s/Pulumi.yaml`, Tamanu CD `cd-up.yml` |
| Namespace | `tamanu-` plus the stack name lowercased, other characters turned into `-`, cut to 56 characters. A `namespace` config key overrides it. | [K8SNSP](spec/kubernetes/namespaces.md#deployment-namespaces), `pulumi/tamanu/on-k8s/src/namespace.ts` |
| Argo CD Application | Same name as the namespace, in `argocd-system` unless the cluster sets `argoNamespace`. | [K8STDR](spec/kubernetes/tamanu/deployment-rollout.md#application) |
| Cluster | The `k8s-core` stack config key, `bes/k8s-core/<cluster-stack>`. Tamanu deployments run on `tamanu-internal-main` and `shared-demos-demo`. | `pulumi/scripts/tamanuStacks.fish`, `.github/workflows/infra-argo-tamanu-renderer-promote.yml` |
| Addresses | `central.<base>`, `<facility host>.<base>` and `portal.<base>`. `<base>` is `<stack>.cd.tamanu.app` on the main cluster and `<stack without -demo>.demos.tamanu.app` on the demo cluster, unless `domainBase` is set. | [config reference](reference/tamanu-deployment-config.md#identity-and-addresses) |

If you only have a hostname, read the stack from the first label after `central.`, `portal.` or the facility host, then check the namespace exists on each cluster:

```sh
kubectl --context <context> get namespace tamanu-<stack>
```

[Connect to the cluster](sops/connect-to-k8s-cluster.md) first.
A stack's config is gitignored and not in the repository, so `pulumi stack ls` and `pulumi config -s <stack>` are the places to read it.

## Reading the state

Read the Application first.
Reading it with `kubectl` needs access to `applications` in the Argo CD namespace, which [K8SNSP](spec/kubernetes/namespaces.md#roles) grants to the deployer group only.
Everyone else uses the Argo CD UI, reached over the tailnet at `argocd-<cluster-stack>` unless the cluster sets `argoTailscaleName`.

```sh
kubectl -n argocd-system get app tamanu-<stack> -o json | jq '{labels: .metadata.labels, sync: .status.sync.status, health: .status.health.status, conditions: .status.conditions}'
```

| What | Where | How |
|---|---|---|
| Sync and health | Application `status` | The command above, or the Argo CD UI. [Inspect an Application](sops/inspect-application.md) goes further. |
| Tamanu version | Label `bes.tamanu/app-version` | The command above. |
| Image tag, config as passed | `PARAMS` in `spec.source.plugin.env[0].value`: `imageTag`, `appVersion`, `config`, `cluster`. It holds no secrets. | `jq -r '.spec.source.plugin.env[0].value \| fromjson \| {imageTag, appVersion, config}'` on the Application JSON. |
| Renderer channel | Label `bes.tamanu/renderer-channel`, or `spec.source.plugin.name` | `stable` unless the stack asks for `canary` ([K8STRO](spec/kubernetes/tamanu/renderer-rollout.md#channels)). |
| Config template | Label `bes.tamanu/template` | `pr`, `rc`, `basic` or `demo`. |
| Addresses | Annotations `link.argocd.argoproj.io/*` | In the Argo CD UI they are links on the Application. |
| Workload state | Deployments in the namespace | `kubectl -n tamanu-<stack> get deploy`, [object names](reference/tamanu-deployment-objects.md). |
| Hibernation | `cnpg.io/hibernation` on each database `Cluster`, `downscaler/force-downtime` on each Deployment | See below. |

### Hibernation state

A deployment with a time to live is hibernated when it expires ([K8STSD](spec/kubernetes/tamanu/scaledown.md#hibernation)).

```sh
kubectl -n tamanu-<stack> get clusters.postgresql.cnpg.io -o json \
  | jq '.items[] | {name: .metadata.name, hibernation: .metadata.annotations["cnpg.io/hibernation"]}'
kubectl -n tamanu-<stack> get deploy -o json \
  | jq '.items[] | {name: .metadata.name, replicas: .spec.replicas, forced: .metadata.annotations["downscaler/force-downtime"]}'
```

`hibernation: "on"` and `forced: "true"` on everything means hibernated.
Argo CD reports a hibernated `Cluster` as Healthy with the message `Hibernated` ([K8STDR](spec/kubernetes/tamanu/deployment-rollout.md#database-health)).
No `wake` CronJob in the namespace means the deployment has no time to live ([K8STSD](spec/kubernetes/tamanu/scaledown.md#waking)).

When it expires is in the schedule of the `ttl-hibernate-*` CronJob, a single UTC slot as `minute,minute+10 hour day-of-month month *`:

```sh
kubectl -n tamanu-<stack> get cronjob -o json | jq '.items[] | select(.metadata.name | startswith("ttl-hibernate")) | {name: .metadata.name, schedule: .spec.schedule}'
```

The slot is the first of minutes 00, 20 and 40 at or after the expiry, so it can lag the expiry by up to 20 minutes.
Every `pulumi up` moves the expiry ([K8STSD](spec/kubernetes/tamanu/scaledown.md#time-to-live)).

## Origin

Deployments made by Tamanu CD carry a ConfigMap named `auto-deploy` in their namespace with the keys `repo`, `ref`, `control` and `imageTag`:

```sh
kubectl -n tamanu-<stack> get configmap auto-deploy -o json | jq .data
```

`control` is `pr=<number>` for a pull request deployment, which is disposable, and `issue=<number>` for one controlled by an auto-deploy issue, which is long-lived and managed by hand.
Tamanu CD ticks off and tears down pull request deployments after a period without activity and again after the pull request closes, and its option defaults, `ttlhours` among them, are in `packages/scripts/src/ghaCdHelpers.mjs` in the Tamanu repository.
A namespace without the ConfigMap was made by hand or by an older flow: treat it as long-lived ([ruled-out actions](ruled-out-actions.md#disposable-and-long-lived-deployments)).

## Quirks and notes

Per-deployment quirks do not belong in this pack, and the repository names no fleet or monitoring tool that holds them for Kubernetes deployments.
Ask a developer where they are kept, and draft any new note generically: deployment, symptom, why it is expected, what to do or not do.

## Gaps

The repository does not record which deployments hold data that matters, which have supported hours, or who owns each demo.
Ask a developer rather than inferring it from the stack name.

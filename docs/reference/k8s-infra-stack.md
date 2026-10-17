# Reference: the `tamanu/k8s-infra` stack

The once-per-cluster stack that lays down the ground every Tamanu deployment uses.
Stack: `pulumi/tamanu/k8s-infra` (project `tamanu-k8s-infra`), one stack per cluster, applied over the tailnet.
Per-deployment stacks are out of scope here.
The authority is the code in that directory; what it must provide is in [K8SNSP](../spec/kubernetes/namespaces.md).

## Namespaces

| namespace | holds | in the HNC tree |
|---|---|---|
| `tamanu-super` | Role bindings that HNC propagates to every deployment namespace; each deployment namespace is a subnamespace of it ([namespace tree](../spec/kubernetes/namespaces.md#namespace-tree)). | root |
| `tamanu-system` | Cluster-wide secrets and the config templates deployments copy. | no |
| `tamanu-seed` | The pgsnap operator and seed jobs. | no |

Deleting the anchor of a deployment namespace deletes the namespace and everything in it.

## Config

Keys under `tamanu-k8s-infra:` unless noted.

| key | required | effect |
|---|---|---|
| `k8s-core` | yes | Cross-stack reference, `bes/k8s-core/<stack>`. |
| `bugsnagApiKey` | yes (secret) | Becomes secret `bugsnag`, key `apiKey`, in `tamanu-system`. |
| `mailgun` | yes (secret object) | Becomes secret `mailgun` in `tamanu-system`. |
| `tupaia` | yes (secret object) | Becomes secret `tupaia` in `tamanu-system`. |
| `pgsnap:imageTag` | no | Image tag of the pgsnap operator. Omit the key and the operator is not deployed. |
| `argoEnabled` | no, default `false` | Adds the Tamanu side of Argo CD: the render plugins, the `tamanu` AppProject and the deployer's access to Applications. Needs Argo CD installed by [k8s-essentials](k8s-essentials-config.md) first. |
| `argoNamespace` | no, default `argocd-system` | Must match the k8s-essentials value. |

The stack will not preview without the three required secrets.
Set them with `pulumi config set --secret`, never in a file you commit.
The only key that changes in normal operation is `pgsnap:imageTag`.

```yaml
config:
  tamanu-k8s-infra:k8s-core: bes/k8s-core/<stack>
  tamanu-k8s-infra:bugsnagApiKey:
    secure: <set with pulumi config set --secret>
  pgsnap:imageTag: <tag>
```

## Config templates

ConfigMaps in `tamanu-system`, four variants (`basic`, `pr`, `rc`, `demo`) of three files each:

| ConfigMap | label `bes.tamanu/template` | holds |
|---|---|---|
| `provisioning-template-<variant>` | `provisioning` | `provisioning.json5.njk` |
| `config-central-template-<variant>` | `config-central` | `local.json5.njk` |
| `config-facility-template-<variant>` | `config-facility` | `local.json5.njk` |

The source files are `pulumi/tamanu/k8s-infra/templates/<variant>/`.
The stack ignores later changes to a ConfigMap's data, so editing a template file in the repository changes nothing on a cluster that already has the ConfigMap.
A template change has to be made on the ConfigMap itself, or the ConfigMap replaced.

## Roles and access

The `tamanu-deploy`, `tamanu-engineer`, `tamanu-deploy-cluster`, `tamanu-deploy-system` and `tamanu-gha-dbt-build` roles and their bindings are defined in `roles/` and `system/roles.ts` and specified in [K8SNSP](../spec/kubernetes/namespaces.md#access-groups).
Role bindings that apply to the whole subtree are created once in `tamanu-super` and propagate.
If a new deployment namespace lacks a binding, check HNC first ([runbook](../runbooks/hnc-pods-not-starting.md)).

## pgsnap

The operator runs in `tamanu-seed` on `workload` arm64 nodes.
It acts on Jobs that carry the label `pgsnap.bes.au/create: "true"` ([PGS](../spec/pgsnap.md#annotation-contract)).

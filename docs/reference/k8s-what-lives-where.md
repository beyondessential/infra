# Reference: what lives where on a cluster

Lookup for which Pulumi stack owns a cluster component, which credentials that stack needs, and which namespace the component runs in.
The code is the authority; every row names the file to check.
What a cluster must provide is in the specs ([K8SNOD](../spec/kubernetes/nodes.md), [K8SNSP](../spec/kubernetes/namespaces.md), [K8SING](../spec/kubernetes/ingress.md)); this page does not restate it.

## Names used in the cluster pages

| placeholder | meaning | example |
|---|---|---|
| `<account>` | The core stack of the AWS account, `bes/core/<account>`. | `tamanu-internal` |
| `<stack>` | The full stack name of `k8s-core`, and of `k8s-essentials` for the same cluster: `<account>-<cluster>`. | `tamanu-internal-main` |
| `<cluster>` | The EKS cluster name: `<stack>` with the leading `<account>-` removed (`stackName` in `pulumi/common/coreRef.ts`). | `main` |
| `<context>` | The kubeconfig context name. | `main` |
| `<profile>` | The aws-sso profile for the account. | |

Things named after `<cluster>`: the EKS cluster, AWS Backup vault `bes-k8s-<cluster>-eks`, backup bucket `bes-k8s-<cluster>-backups`, the Karpenter SQS queue, the external-dns TXT owner id `k8s-extdns-<cluster>`.
Things named after `<stack>`: the Tailscale device `k8s-operator-<stack>`, which is the API server proxy hostname (`pulumi/k8s-essentials/tailscale.ts`).

## Stacks and credentials

| project | config namespace | cross-stack key | credentials to apply | owns |
|---|---|---|---|---|
| `pulumi/core` | `core:` | none | AWS, an AdminAccess profile for changes | VPC and subnets, account zone, `canopy-dns` role |
| `pulumi/k8s-core` | `k8s-core:` | `core` = `bes/core/<account>` | AWS, aws-sso | EKS, nodes, storage, AWS-side add-on identities |
| `pulumi/k8s-essentials` | `k8s-essentials:` | `k8s-core` = `bes/k8s-core/<stack>` | tailnet only, after [bootstrap](../sops/bootstrap-k8s-cluster.md) | shared in-cluster services |
| `pulumi/tamanu/k8s-infra` | `tamanu-k8s-infra:` | `k8s-core` | tailnet only | Tamanu shared namespaces ([page](k8s-infra-stack.md)) |
| `pulumi/canopy-infra` | `canopy-infra:` | `k8s-core`, `core` | AWS (central account) | Canopy IAM identities |
| `pulumi/canopy` | `canopy:` | `k8s-core`, `canopy-infra` | tailnet only | Canopy workloads ([page](canopy-tls-config.md)) |

`failIfIncorrectAccountOrRegion()` (k8s-core) and `failIfIncorrectCluster()` (every in-cluster stack) stop a run pointed at the wrong account, region or cluster: see [cluster-api-unreachable](../runbooks/cluster-api-unreachable.md).
Stack config files (`Pulumi.<stack>.yaml`) are gitignored: pull them with [refresh-stack-config](../sops/refresh-stack-config.md).

## Component ownership

| component | stack | file | namespace |
|---|---|---|---|
| EKS control plane, OIDC provider | k8s-core | `cluster.ts` | none |
| EKS add-ons `vpc-cni`, `kube-proxy`, `coredns`, `aws-ebs-csi-driver`, `snapshot-controller`, `eks-node-monitoring-agent` (always); `aws-efs-csi-driver`, `aws-mountpoint-s3-csi-driver` (when enabled) | k8s-core | `cluster.ts`, `storage/`, `nodes/monitor.ts` | `kube-system` |
| Bootstrap nodegroups (always defined) | k8s-core | `nodes/groups.ts` | none |
| Karpenter controller, SQS interruption queue, EventBridge rules | k8s-core | `karpenter/controller.ts` | `kube-system` |
| Karpenter EC2NodeClasses, NodePools, placeholder Deployments | k8s-core | `karpenter/classes.ts`, `pools.ts`, `placeholders.ts` | cluster-scoped, `kube-system` |
| StorageClasses, VolumeSnapshotClasses | k8s-core | `storage/ebs.ts`, `storage/efs.ts` | cluster-scoped |
| AWS Load Balancer Controller | k8s-core | `loadbalancer/ingress.ts` | `kube-system` |
| cert-manager, `letsencrypt` and `zerossl` ClusterIssuers | k8s-core | `cert-manager/` | `cert-manager` |
| external-dns | k8s-core | `externalDns.ts` | `kube-system` |
| Backup bucket and IRSA role `s3-backups` | k8s-core | `backups.ts` | role usable from any namespace |
| AWS Backup of the EKS cluster resource | k8s-core | `awsBackup.ts` | none |
| OpenCost IAM role and buckets | k8s-core | `opencost.ts` | none |
| Envoy Gateway, Gateway API CRDs, GatewayClass `envoy`, HTTP/3 admission policy | k8s-essentials | `envoyGateway.ts` | `envoy-gateway-system` |
| NGINX ingress (optional) | k8s-essentials | `ingress.ts` | `ingress-system` |
| Tailscale operator, optional exit node | k8s-essentials | `tailscale.ts` | `tailscale-system` |
| Prometheus, OpenCost, engineer `view` binding | k8s-essentials | `metrics/` | `metrics-system` |
| CloudNativePG, Barman Cloud plugin, image catalogs | k8s-essentials | `postgres/cnpg.ts` | `cnpg-system` |
| HNC | k8s-essentials | `hnc/` | `hnc-system` |
| py-kube-downscaler | k8s-essentials | `downscaler.ts` | `kube-downscaler` |
| Argo CD (optional) | k8s-essentials | `argo/index.ts` | `argocd-system` (`argoNamespace`) |
| `oncall` and `data-engineer` roles | k8s-essentials | `roles/` | cluster-wide |
| `tamanu-super`, `tamanu-system`, `tamanu-seed`, Tamanu roles | tamanu/k8s-infra | see [page](k8s-infra-stack.md) | those namespaces |

Role contents and group bindings are in [K8SNSP](../spec/kubernetes/namespaces.md#access-groups).
Node pools and node classes: [k8s-node-pools](k8s-node-pools.md).
Pinned versions: [k8s-component-versions](k8s-component-versions.md).

## Where each part runs

Placement is by node purpose label `bes.node.purpose` ([K8SNOD](../spec/kubernetes/nodes.md#node-identity)).

| purpose | components (required affinity) |
|---|---|
| `system` | Karpenter, external-dns, CNPG, Barman plugin, HNC, py-kube-downscaler |
| `ingress` | AWS Load Balancer Controller, cert-manager, Envoy Gateway controller and proxies, NGINX, Tailscale operator |
| `workload` | Prometheus, OpenCost, pgsnap operator, application workloads |
| `tailscale-exit` | the Tailscale exit node, when enabled |

Loss of every `ingress` node takes the Tailscale operator, and so the API server proxy, down with it: see [cluster-api-unreachable](../runbooks/cluster-api-unreachable.md).

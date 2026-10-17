# Reference: pinned component versions

Where each cluster component's version lives.
The values are a snapshot read from the code; the file named is the authority, so read it for the current pin.

## Pinned in code

| component | pin | kind | file |
|---|---|---|---|
| Karpenter | `1.12.0` | Helm chart (`oci://public.ecr.aws/karpenter/karpenter`); `KARPENTER_VERSION` | `pulumi/k8s-core/karpenter/controller.ts` |
| cert-manager | `1.20.0` | Helm chart | `pulumi/k8s-core/versions.ts` |
| AWS Load Balancer Controller | `3.1.0` | Helm chart | `pulumi/k8s-core/versions.ts` |
| external-dns | `0.20.0` | controller image tag | `pulumi/k8s-core/versions.ts` |
| Envoy Gateway | `v1.8.3` | Helm chart, and the CRD chart `gateway-crds-helm` at the same version | `pulumi/k8s-essentials/versions.ts` |
| Gateway API CRDs | `v1.5.1` | experimental bundle; checked against the cluster before deploy | `pulumi/k8s-essentials/versions.ts` |
| NGINX ingress | `4.15.1` | Helm chart | `pulumi/k8s-essentials/versions.ts` |
| HNC | `1.1.0` | source tag built by an init container at pod start | `pulumi/k8s-essentials/versions.ts` |
| OpenCost | `2.5.11` | Helm chart | `pulumi/k8s-essentials/versions.ts` |
| Prometheus | `28.13.0` | Helm chart | `pulumi/k8s-essentials/versions.ts` |
| CloudNativePG | `0.27.1` | Helm chart | `pulumi/k8s-essentials/versions.ts` |
| Barman Cloud plugin | `0.6.0` | Helm chart (plugin image `v0.12.0`) | `pulumi/k8s-essentials/versions.ts` |
| Tailscale operator | `1.94.2` | Helm chart | `pulumi/k8s-essentials/versions.ts` |
| py-kube-downscaler | `0.3.12` | Helm chart | `pulumi/k8s-essentials/versions.ts` |
| Argo CD | `10.10.2` | Helm chart (Argo CD `v3.5.4`); `argoVersion` overrides it per stack | `pulumi/k8s-essentials/versions.ts` |
| Kubernetes | stack config | `k8s-core:version`; EKS ignores later edits | `pulumi/k8s-core/cluster.ts` |

## Not pinned

| thing | how it is chosen |
|---|---|
| EKS add-ons (`vpc-cni`, `kube-proxy`, `coredns`, `aws-ebs-csi-driver`, `snapshot-controller`, `eks-node-monitoring-agent`, and the EFS and S3 drivers when enabled) | The latest version compatible with the Kubernetes version when the add-on is first created. Pulumi ignores `addonVersion` afterwards, so upgrades are done in the AWS console ([update procedure](../sops/update-k8s-cluster.md)). |
| Node AMI | `bottlerocket@latest` in every EC2NodeClass; Karpenter replaces drifted nodes when a new AMI is published. |
| CNPG image catalogs | Fetched from the `main` branch of the upstream container repositories at apply time (`pulumi/k8s-essentials/postgres/cnpg.ts`). |
| HNC build image | `golang:1.21`, plus `gcr.io/distroless/static:nonroot` at run time (`pulumi/k8s-essentials/hnc/specs.ts`). |
| pgsnap operator | `pgsnap:imageTag` in the `tamanu/k8s-infra` config ([page](k8s-infra-stack.md)). |

## Coupling to respect when bumping

- Envoy Gateway and Gateway API CRDs move together: Helm never upgrades CRDs shipped in a chart, and k8s-essentials refuses to deploy a controller the installed bundle cannot serve ([runbook](../runbooks/envoy-gateway-crd-mismatch.md)).
- Karpenter, cert-manager, the load balancer controller and external-dns are bumped in k8s-core (needs AWS credentials); every other row is bumped in k8s-essentials (tailnet only).
- Bump order and cautions: [update-k8s-cluster](../sops/update-k8s-cluster.md).

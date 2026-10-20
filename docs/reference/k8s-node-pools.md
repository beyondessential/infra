# Reference: node pools and node classes

What `useKarpenter: true` creates, for reading Karpenter output and pending-pod events.
What a node must be is in [K8SNOD](../spec/kubernetes/nodes.md); the numbers below are what the code sets today.
The authority is `pulumi/k8s-core/karpenter/pools.ts` and `classes.ts`.

## Node pools

A higher weight wins when several pools can satisfy a pod.
Every pool sets `expireAfter: 168h` and `terminationGracePeriod: 30m` unless noted.
All pools are arm64 except the two `x86` ones.

| pool (`bes.node.group`) | purpose | capacity | weight | taints | other |
|---|---|---|---|---|---|
| `workload-arm-spot` | workload | spot | 80 | spot `PreferNoSchedule` | limit 1000 CPU, 2000Gi; consolidate after 30m |
| `workload-x86-spot` | workload (amd64) | spot | 60 | spot | limit 500 CPU, 1000Gi |
| `ingress-arm` | ingress | spot or on-demand | 50 | none | limit 100 CPU, 200Gi; budget 1 node; consolidate after 10m |
| `system-arm-spot` | system | spot | 45 | spot | burstable types; `WhenEmpty` after 30m |
| `system-arm` | system | on-demand | 40 | none | burstable types; `WhenEmpty` after 30m; limit 50 CPU, 100Gi |
| `workload-arm-ondemand` | workload | on-demand | 30 | none | one shape, 4 vCPU 16 GiB; limit 500 CPU |
| `workload-x86-ondemand` | workload (amd64) | on-demand | 10 | none | one shape, 4 vCPU 16 GiB |
| `db-replica` | workload | spot, falls back to on-demand | 10 | `bes.node.group=db-replica:NoSchedule`, spot | `x8g.medium`, `x8g.large`, `r6g.large`; `WhenEmpty`; limit 100 CPU, 1600Gi |
| `db-critical` | workload | on-demand | 10 | `bes.node.group=db-critical:NoSchedule` | `r8g.large`, `r7g.large`, `r6g.large`; never expires; replaced on drift only, 1 node at a time, 14:00 to 16:00 UTC; limit 16 CPU, 128Gi |
| `tailscale-exit` | tailscale-exit | on-demand | 10 | `bes.node.purpose=tailscale-exit:NoSchedule` | `t4g.small`, `t4g.medium`; limit 4 CPU, 8Gi |
| `gpu` (only with `gpuPool: true`) | workload (amd64) | on-demand | 10 | `bes.node.group=gpu:NoSchedule` | `g4dn`, `g6`, `g5` at `xlarge` and `2xlarge`; `WhenEmpty`; limit 2 GPUs, 16 CPU, 64Gi |

A pod gets a GPU node by tolerating `bes.node.group=gpu:NoSchedule`, selecting `bes.node.group: gpu`, and setting `resources.limits["nvidia.com/gpu"]`.
Karpenter takes the cheapest type that fits (usually `g4dn.xlarge`, T4); a pod can pin a GPU model with the node label `karpenter.k8s.aws/instance-gpu-name` (`t4`, `a10g`, `l4`).

Only a pod that tolerates the `NoSchedule` taint of a dedicated pool can land there ([dedicated pools](../spec/kubernetes/nodes.md#database-pools)).
Spot instance types are filtered by price against on-demand and by interruption frequency (10% or less) from the curated price list `pulumi/common/instances.json` (refreshed by hand with `pulumi/common/refreshInstances.sh`), so the type list changes only when the list or the stack is updated.

## Node classes

All classes use `bottlerocket@latest`, IMDSv2 with IPv6 enabled and hop limit 2, a gp3 encrypted data volume, subnets selected by subnet id, and the cluster security group.

| class | subnets | data volume | max pods | `Purpose` tag |
|---|---|---|---|---|
| `workload` | workload | `workloadDiskGi` (60) | 110 | `k8s-workload` |
| `db-replica` | workload | `workloadDiskGi` | 15 | `k8s-db-replica` |
| `db-critical` | workload | `workloadDiskGi` | 15 | `k8s-db-critical` |
| `ingress` | NAT | 15Gi | default | `k8s-ingress` |
| `system` | workload | 15Gi | default | `k8s-system` |
| `tailscale-exit` | workload | 15Gi | 15 | `k8s-tailscale-exit` |
| `gpu` (only with `gpuPool: true`) | workload | `gpuDiskGi` (100) | 15 | `k8s-gpu` |

On GPU instance types `bottlerocket@latest` resolves to the Bottlerocket NVIDIA variant, which carries the driver and the device plugin.

Tag values on a class propagate to the IAM instance profile Karpenter creates, so they must use only characters IAM accepts ([runbook](../runbooks/nodes-not-provisioning.md)).

## Bootstrap nodegroups and placeholders

| thing | detail |
|---|---|
| Managed nodegroups `bootstrap-system` (workload subnets) and `bootstrap-ingress` (NAT subnets) | One per AZ, two AZs at most, on-demand burstable arm64, 25 GiB disk, min 0, max 1. They carry `bes.node.group=bootstrap-<purpose>`, `bes.node.purpose`, `bes.node.schedule=ondemand`, `bes.node.arch=arm64` and `karpenter.sh/capacity-type=on-demand`. See [scale procedure](../sops/scale-bootstrap-nodegroups.md). |
| Deployments `placeholder-system`, `placeholder-ingress` in `kube-system` | One pod each, priority class `bes-placeholder` (-1000, never preempts), pinned to that purpose. They keep a node of each purpose alive; if the node is lost the placeholder goes Pending and Karpenter provisions a replacement. |
| Karpenter controller | Two replicas on `system` nodes, one per capacity type (`DoNotSchedule` spread on `karpenter.sh/capacity-type`), annotated `karpenter.sh/do-not-disrupt`. Interruption notices arrive through an SQS queue fed by four EventBridge rules (health, spot interruption, rebalance, state change). |

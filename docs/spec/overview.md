---
id: OVR
---

# Overview

These specifications describe the infrastructure BES operates: its Kubernetes clusters, the Tamanu deployments on them, and the operators and tools that support them.

## Requirements notation

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED, MAY and OPTIONAL in these specifications are to be interpreted as described in BCP 14 ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals, as here.

## External documents

| document | what it covers |
|---|---|
| [Amazon EC2 instance metadata service configuration](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html) | IMDSv2 and the metadata options of an instance. Used by [K8SNOD](kubernetes/nodes.md). |
| [Spot Instance interruptions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-interruptions.html) | The warning EC2 gives before reclaiming a Spot instance. Used by [K8SNOD](kubernetes/nodes.md). |
| [Spot Instance Advisor](https://aws.amazon.com/ec2/spot/instance-advisor/) | The published interruption frequency of each instance type. Used by [K8SNOD](kubernetes/nodes.md). |
| [Service-linked role for Spot Instance requests](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/service-linked-roles-spot-instance-requests.html) | The `AWSServiceRoleForEC2Spot` role. Used by [K8SNOD](kubernetes/nodes.md). |
| [Karpenter disruption](https://karpenter.sh/docs/concepts/disruption/) | Consolidation and drift. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/) | PodDisruptionBudgets. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes taints and tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) | Taints, tolerations and their effects. Used by [K8SNOD](kubernetes/nodes.md). |
| [Kubernetes garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) | The kubelet's image garbage collection thresholds. Used by [K8SNOD](kubernetes/nodes.md). |

## Terminology

### Node pool

A set of nodes provisioned from one shared configuration, whether by a managed nodegroup or by a Karpenter NodePool.
Defined in [K8SNOD](kubernetes/nodes.md#node-identity).

### Dedicated pool

A node pool that only workloads which explicitly opt in can use.
Defined in [K8SNOD](kubernetes/nodes.md#database-pools).

### General workload pool

A node pool with purpose `workload` that is not a dedicated pool.
Defined in [K8SNOD](kubernetes/nodes.md#workload-capacity).

### Database replica pool

The dedicated pool that hosts restored database replicas.
Defined in [K8SNOD](kubernetes/nodes.md#database-pools).

### Critical database pool

The dedicated pool that hosts the databases production depends on.
Defined in [K8SNOD](kubernetes/nodes.md#database-pools).

### Exit node

A Tailscale node that forwards the internet traffic of connected clients, run as a workload in the cluster.
Defined in [K8SNOD](kubernetes/nodes.md#exit-node).

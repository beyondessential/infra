---
id: K8SNOD
---

# Kubernetes nodes

The requirements in this spec apply to every worker node of a cluster, whichever autoscaler provisioned it.

## Borrowed terms

| term | meaning |
|---|---|
| consolidation | Karpenter's removal or replacement of underutilised nodes by draining their pods onto other nodes ([Karpenter disruption](https://karpenter.sh/docs/concepts/disruption/)). |
| drift | The state of a node that no longer matches its configured specification ([Karpenter disruption](https://karpenter.sh/docs/concepts/disruption/)). |
| taint | A node attribute that repels pods which do not tolerate it ([Kubernetes taints and tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)). |
| IMDSv2 | The session-oriented method of the EC2 instance metadata service ([Amazon EC2 instance metadata service configuration](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)). |
| spot interruption warning | The notice EC2 gives before it reclaims a Spot instance ([Spot Instance interruptions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-interruptions.html)). |
| interruption frequency | The reclaim rate band the Spot Instance Advisor publishes for an instance type in a region ([Spot Instance Advisor](https://aws.amazon.com/ec2/spot/instance-advisor/)). |
| image garbage-collection high threshold | The disk usage, 85% by default, above which the kubelet begins deleting unused images ([Kubernetes garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/)). |

## Node identity

A [node pool](../overview.md#node-pool) is a set of nodes provisioned from one shared configuration, whether by a managed nodegroup or by a Karpenter NodePool.

Every node MUST carry each of the labels in the following table, with a value permitted for it.

| label | values | meaning |
|---|---|---|
| `bes.node.purpose` | `workload`, `ingress`, `system`, `tailscale-exit` | What the node is for. Drives workload affinity and cost attribution. |
| `bes.node.schedule` | `spot`, `ondemand` | The EC2 capacity type backing the instance. |
| `bes.node.arch` | `arm64`, `amd64` | The CPU architecture of the node. |
| `bes.node.group` | the name of a node pool | The node pool that created the node. Used for cost attribution and filtering. |

The value of `bes.node.schedule` MUST be the capacity type that backs the node's instance.

The value of `bes.node.arch` MUST be the CPU architecture of the node.

The value of `bes.node.group` MUST be the name of the node pool that created the node.

A node on spot capacity MUST carry the taint `spotInstance=true:PreferNoSchedule`.

## Placement

A node with purpose `ingress` MUST be placed in a subnet tagged `Purpose: nat`.

A node with purpose `workload`, `system` or `tailscale-exit` MUST be placed in a subnet tagged `Purpose: workload`.

Traffic that an [exit node](../overview.md#exit-node) forwards MUST egress through the NAT gateways, so that its source addresses are the Elastic IPs of those gateways.

> [!NOTE]
> Partners allowlist the Elastic IPs of the NAT gateways.
> Egress through the internet gateway would use the ephemeral public IP of the instance.

The subnets and security groups an autoscaler uses to provision a cluster's nodes MUST be selectable by tags that identify the owning cluster.

> [!NOTE]
> Several clusters can then share one VPC without selecting each other's subnets or security groups.

## Instance metadata

A node MUST require IMDSv2.

The instance metadata endpoint of a node MUST be reachable over IPv6.

> [!NOTE]
> Pods running in IPv6-only contexts reach the endpoint this way.

## System capacity

A cluster's system capacity MUST include an on-demand node pool.

Where a spot system pool also exists, the replicas of the autoscaler controller MUST be spread across capacity types so that at least one replica runs on on-demand capacity.

> [!NOTE]
> The on-demand pool is the fallback for the autoscaler controller and other cluster-critical components during a spot capacity drought.
> Spreading the replicas keeps a simultaneous loss of spot nodes from taking down all of them.

## Workload capacity

A [general workload pool](../overview.md#general-workload-pool) is a node pool with purpose `workload` that is not a dedicated pool.

A workload SHOULD run on spot capacity wherever it tolerates the spot taint.

A cluster MUST offer on-demand workload capacity for workloads that do not tolerate the spot taint.

A node pool with purpose `workload` MUST NOT offer burstable instance types, the `t` family.

> [!NOTE]
> The CPU credits of a burstable type exhaust unpredictably under sustained load.

A node in a general workload pool MUST admit 110 pods.

> [!NOTE]
> Under a pod limit derived from network interfaces, small pods exhaust the slots of a node while most of its memory sits idle.

A node in a general workload pool MUST NOT be smaller than 4 vCPU and 8 GiB, except as the following requirements allow.

A general spot workload pool MAY offer memory-dense nodes, which have 16 GiB or more per vCPU, of at least 2 vCPU and 32 GiB.

A general spot workload pool MAY offer a range of node shapes above the size floor.

A general on-demand workload pool MUST offer a single node shape.

> [!NOTE]
> The size floor amortises per-node fixed costs (node disks, daemonsets, the kubelet reserve) over enough capacity.
> A single shape cannot fragment into many small nodes, which the provisioner would never consolidate because its cost model prices instance rates and not node disks.
> A memory-dense node amortises those costs as well as the floor does, and without such nodes a pod-dense cluster strands most of its node memory.

## Spot capacity

An account hosting a cluster MUST have the EC2 Spot service-linked role, `AWSServiceRoleForEC2Spot` ([Service-linked role for Spot Instance requests](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/service-linked-roles-spot-instance-requests.html)).

Spot instance type selection SHOULD exclude types whose current spot price exceeds their on-demand price.

Spot instance type selection for workload and ingress pools MUST exclude types whose interruption frequency in the cluster's region exceeds 10%, and types with no published interruption frequency.

> [!NOTE]
> A reclaim drains every pod on the node, database primaries included, so a type that is cheap but often reclaimed costs more in churn than it saves.

## Interruption and consolidation

On a spot interruption warning for a node, the cluster MUST cordon the node, drain its pods, and remove the node from service before the reclaim takes effect.

On an EC2 instance health event for a node, such as a scheduled hardware retirement, the cluster MUST replace the node.

Underutilised nodes SHOULD be consolidated.

A spot workload pool MUST NOT consolidate an underutilised node until the pods on it have been unchanged for 30 minutes.

> [!NOTE]
> A spot reclaim scatters pods across the pool.
> Consolidating straight afterwards would drain those pods a second time, database primaries among them, for a saving of cents an hour.

## Database pools

A [dedicated pool](../overview.md#dedicated-pool) is a node pool that only workloads which explicitly opt in can use.

The database replica pool and the critical database pool are dedicated pools.

The database replica pool MUST offer memory-dense node shapes, sized so that one database replica fills a node.

The instance types of the database replica pool MUST meet the interruption frequency limit that applies to spot instance type selection.

The database replica pool MUST prefer spot capacity.

The database replica pool MUST fall back to on-demand capacity when spot capacity is unavailable.

> [!NOTE]
> A replica then never waits on spot capacity to schedule.

The nodes of the database replica pool MUST be attributable as replica capacity in cost reporting.

The critical database pool MUST use on-demand capacity only.

> [!NOTE]
> No reclaim then ever moves a production database.

The critical database pool MUST offer memory-dense node shapes.

A node in the critical database pool MUST NOT expire on a fixed lifetime.

A node in the critical database pool MUST be replaced only when it drifts from its configuration.

The critical database pool MUST replace at most one node at a time.

The critical database pool MUST replace nodes only within a daily maintenance window of 14:00 to 16:00 UTC.

The nodes of the critical database pool MUST be attributable as critical database capacity in cost reporting.

## Exit node

An exit node is a Tailscale node that forwards the internet traffic of connected clients, run as a workload in the cluster.

An exit node MUST run on a node with no workload other than daemonsets.

An exit node MUST run on on-demand capacity.

> [!NOTE]
> An exit node is a live network path.
> Compute contention on a shared node would degrade routing, and a spot reclaim would interrupt every connected client.

The instance of the node running an exit node MUST carry the tag `bes.node.purpose=tailscale-exit`.

> [!NOTE]
> The tag attributes the egress of the exit node in network monitoring, for example GuardDuty, and lets that egress be governed without affecting detection on other nodes.

## Node storage

A node with purpose `workload` MUST have a node-local data volume large enough for its steady-state usage, covering images, logs and ephemeral scratch, to stay below the image garbage-collection high threshold.

The size of the data volume of a workload node MUST be configurable per cluster.

The size of the data volume of a workload node SHOULD default to 60 GiB for a cluster whose usage has not been measured.

A node with purpose `ingress` or `system` MUST have a node-local data volume of at least 15 GiB.

Every node data volume MUST be an encrypted EBS volume of type gp3.

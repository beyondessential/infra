# Kubernetes nodes

This spec covers compute provisioning for Kubernetes worker nodes: identity,
placement, capacity selection, security posture, and lifecycle. It is
autoscaler-agnostic: the requirements apply equally to managed nodegroups
under Cluster Autoscaler and to Karpenter-provisioned nodes.

## Node identity

k[node.label.purpose+2]
Every node must carry the label `bes.node.purpose`, set to one of `workload`,
`ingress`, `system`, or `tailscale-exit`. This label drives workload affinity
and cost attribution.

k[node.label.schedule]
Every node must carry the label `bes.node.schedule`, set to one of `spot` or
`ondemand`, reflecting the EC2 capacity type backing the instance.

k[node.label.arch]
Every node must carry the label `bes.node.arch`, matching the node's CPU
architecture: `arm64` or `amd64`.

k[node.label.group]
Every node must carry the label `bes.node.group`, naming the provisioning
group/pool that created it. Used for cost attribution and operator-side
filtering.

k[node.taint.spot]
Every spot-capacity node must carry the taint
`spotInstance=true:PreferNoSchedule`. Workloads that explicitly tolerate spot
can land there, while unmodified workloads prefer on-demand when both are
available.

## Placement

k[placement.ingress-subnets]
Nodes with `bes.node.purpose=ingress` must be placed in NAT-egress subnets
(subnets tagged `Purpose: nat`), to allow inbound public traffic to reach
ingress proxies.

k[placement.workload-subnets]
Nodes with `bes.node.purpose` of `workload` or `system` must be placed in
workload subnets (subnets tagged `Purpose: workload`).

k[placement.exit-node-subnets]
Nodes with `bes.node.purpose=tailscale-exit` must be placed in workload
subnets (subnets tagged `Purpose: workload`), so the exit node's forwarded
client traffic egresses through the per-AZ NAT gateways. This gives a stable,
known set of egress IPs (the NAT Elastic IPs) that partners can allowlist,
rather than the ephemeral per-instance public IP that direct IGW egress would
yield.

k[placement.cluster-scoped-discovery]
Cluster-scoped resources (subnets, security groups) used by the autoscaler to
provision nodes must be selectable via tags identifying the owning cluster,
so multiple clusters can safely share VPC infrastructure.

## Instance metadata service

k[imds.v2-required]
All worker nodes must enforce IMDSv2 (`httpTokens=required`). IMDSv1 must be
disabled, to prevent SSRF-style metadata exfiltration.

k[imds.ipv6]
The IMDS endpoint must be reachable over IPv6 (`httpProtocolIpv6=enabled`),
to support pods running in IPv6-only contexts.

## Capacity & cost

k[capacity.system-stable-fallback]
System provisioning must include an on-demand pool, to act as a stable
fallback for the autoscaler controller and other cluster-critical
components in the event of a spot capacity drought. If a spot system
pool also exists, the autoscaler controller must be spread across
capacity types such that at least one replica is always on on-demand —
simultaneous spot loss must not be able to take down every controller
replica at once.

k[capacity.workload-spot-preferred]
Workload-purpose nodes must default to spot capacity where suitable, with
on-demand pools available as fallback for workloads that don't tolerate the
spot taint.

k[capacity.spot-slr]
Accounts hosting a cluster must have the EC2 Spot service-linked role
(`AWSServiceRoleForEC2Spot`). Spot launches fail without it, and the failure
mode is silent: capacity falls back to on-demand pools while the provisioner
retries indefinitely.

k[capacity.spot-price-cap]
Spot instance type selection must exclude types whose current spot price
exceeds their on-demand equivalent (paying more for spot than on-demand is
an anti-pattern).

k[capacity.spot-interruption-cap]
Spot instance type selection for workload and ingress pools must exclude
types whose published interruption frequency in the cluster's region exceeds
10%, and types with no published frequency. A reclaim drains every pod on the
node, database primaries included, so a type that is cheap but often reclaimed
costs more in churn than it saves.

k[capacity.workload-pod-density]
Nodes in general workload pools must admit 110 pods each. Pod slots must not
be what fills a node first: under a limit derived from network interfaces,
small pods exhaust a node's slots while most of its memory sits idle, and
memory-dense instance types can never be the cheapest fit.

k[capacity.no-burstable-large]
Burstable instance types (t-family) must not be used for large workload
pools. Their CPU credits exhaust unpredictably under sustained load.

k[capacity.workload-node-floor+3]
Workload pools must not provision nodes smaller than 4 vCPU / 8 GiB, so
that per-node fixed costs (node disks, daemonsets, kubelet reserve) amortize
over enough capacity. On-demand workload pools must offer a single node
shape: a uniform shape cannot fragment into many small nodes, which the
provisioner's instance-rate-only cost model would never consolidate (it does
not price node disks). Spot workload pools may offer a range of shapes
above the floor, for capacity diversity, and may also offer memory-dense
shapes (16 GiB or more per vCPU) of at least 2 vCPU / 32 GiB: a node that
size amortises the fixed costs as well as a 4 vCPU / 8 GiB one, and without
them pod-dense clusters strand most node memory. Dedicated workload pools, which only
workloads that explicitly opt in can use, are exempt from both constraints:
their shapes are chosen to fit the workload that opts in, not to amortise
fixed costs across many pods.

k[capacity.db-replica-pool]
Restored database replicas must have a dedicated workload pool that only
workloads which explicitly opt in can use. It must offer memory-dense shapes
sized so that one replica fills a node, drawn from instance types with low
spot interruption rates in the cluster's region. It must prefer spot capacity
and fall back to on-demand when spot capacity is unavailable, so a replica
never waits on spot capacity to schedule. Its nodes must be attributable as
replica capacity in cost reporting.

k[capacity.db-critical-pool]
Databases that production depends on must have a dedicated workload pool that
only workloads which explicitly opt in can use. It must run on on-demand
capacity only, so that no reclaim ever moves a database. It must offer
memory-dense shapes. Its nodes must not expire on a fixed lifetime; they must
be replaced only when they drift from their configuration, at most one at a
time, and only during a daily maintenance window. Its nodes must be
attributable as critical database capacity in cost reporting.

k[capacity.exit-node-dedicated]
The Tailscale exit node must run on its own node, isolated from all other
workloads, on on-demand capacity — it is a live network path, so workload
compute contention on a shared node would degrade routing, and a spot reclaim
would interrupt it entirely, for connected clients. The node must be
tagged distinctively at the instance level so the exit node's internet egress
is independently attributable in network monitoring (e.g. GuardDuty) and can
be governed without affecting detection on other nodes.

## Interruption & lifecycle

k[interruption.spot-handling]
Spot interruption warnings (delivered ~2 minutes before reclaim) must trigger
graceful node drain: cordon, evict pods respecting PDBs, and remove the node
from service before the EC2 reclaim takes effect.

k[interruption.health-events]
EC2 instance health events (e.g. scheduled hardware retirements) must trigger
replacement of the affected node.

k[lifecycle.consolidation]
Underutilised nodes must be consolidated by draining their pods to other
nodes, allowing the underlying instance to be terminated.

k[lifecycle.spot-consolidation-delay]
Spot workload pools must not consolidate an underutilised node until its pods
have been unchanged for 30 minutes. Spot reclaims scatter pods across the
pool; consolidating straight after would drain those pods a second time, and
database primaries among them, for a saving of cents an hour.

k[lifecycle.disruption-budgets]
Node disruption (consolidation, drift replacement, spot interruption) must
respect PodDisruptionBudgets, so workloads with availability requirements
are not drained beyond their tolerance.

## Storage

k[storage.workload-disk-size]
Workload-purpose nodes must have a node-local data volume sized so that the
cluster's steady-state usage (images, logs, ephemeral scratch) stays clear of
kubelet image-GC pressure (default GC high threshold is 85%). The size must
be tunable per cluster — image churn varies by an order of magnitude between
clusters — defaulting to 60 GiB where a cluster has not been measured.

k[storage.system-ingress-disk-size]
Ingress and system nodes must have at least 15 GiB of node-local data
volume.

k[storage.encryption]
All node data volumes must be encrypted at rest, using gp3 with EBS
encryption.

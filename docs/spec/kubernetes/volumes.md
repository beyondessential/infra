# Persistent volumes

This spec covers the storage a workload can claim from the cluster, and what it
may rely on once it holds a claim. Node-local disks, which back images, logs and
ephemeral scratch rather than workload content, are covered in the nodes spec.

## Shared filesystem

These requirements apply to a cluster that provides shared-filesystem storage.
They say nothing about a cluster that carries no workload needing one.

k[volumes.shared-multi-node+3]
A cluster must offer a storage class whose volumes mount read-write from several
nodes at once wherever it hosts a workload that holds content on disk and either
serves it from more than one replica or hands it between separate processes.
Block storage binds a volume to one node, so such a workload has no class it can
use: the second consumer either fails to schedule or reads an empty directory
while the first holds the only copy.

k[volumes.shared-zone-reach]
A shared-filesystem volume must be mountable from every availability zone the
cluster places workloads in. Pods are scheduled against capacity rather than
storage locality, so a volume reachable from only some zones turns a spot
capacity shift into a mount failure.

k[volumes.shared-isolation+2]
A workload holding a claim must reach that claim's content and no other, even
where the claims share one underlying filesystem, and releasing a claim must
leave the rest untouched. Confinement has to be enforced by the filesystem
rather than by the mounting client, which the cluster does not control.

k[volumes.shared-reclaim]
Releasing a claim must reclaim the space its content occupied. A shared
filesystem outlives every workload that holds a claim on it, so content left by
one that has been torn down accrues cost indefinitely, with nothing referencing
it and nobody watching it.

k[volumes.shared-reclaim-visible]
Where reclaim on release is enabled, the cluster must show whether it is in
effect. The setting reaches the storage driver through a layer that accepts a
key it does not recognise instead of rejecting it, so a cluster can be
configured for reclaim and quietly not perform it, leaving behind exactly the
cost the reclaim was there to avoid.

k[volumes.claim-by-deployer]
Whatever identity brings a workload up must be able to create and release that
workload's claims. A deployment describes its storage in the same manifest as
the rest of it, so an identity that can create the workload but not its claims
fails partway: the claim is refused and the deployment stops holding some of
what it declared.

k[volumes.shared-encryption]
Shared-filesystem content must be encrypted at rest.

k[volumes.shared-network-confinement+2]
The shared filesystem must accept connections only from the cluster's own nodes,
rather than from the surrounding network. Its wire protocol authenticates nothing
itself, so reachability is the whole of the access control, and a VPC holds more
than one cluster's worth of hosts.

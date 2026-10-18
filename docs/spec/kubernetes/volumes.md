---
id: K8SVOL
---

# Persistent volumes

The requirements in this spec apply to the persistent volumes that a cluster offers to its workloads, and to the [shared filesystem](../overview.md#shared-filesystem) among them.

## Borrowed terms

| term | meaning |
|---|---|
| claim | A PersistentVolumeClaim, a workload's request for storage ([Kubernetes persistent volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)). |

## Multi-node access

A shared filesystem is a filesystem whose volumes several nodes mount read-write at once.

Where a cluster hosts a workload that holds content on disk and either serves it from more than one replica or hands it between separate processes, the cluster MUST offer a [storage class](https://kubernetes.io/docs/concepts/storage/storage-classes/) whose volumes mount read-write from several nodes at once.

A shared filesystem volume MUST be mountable from every availability zone in which the cluster places workloads.

> [!NOTE]
> Pods are scheduled against capacity and not against storage locality, so a volume reachable from only some zones turns a spot capacity shift into a mount failure.

## Isolation

A workload holding a claim MUST reach that claim's content and no other, even where several claims share one underlying filesystem.

The filesystem MUST enforce that confinement.

> [!NOTE]
> The cluster does not control the mounting client, so the client cannot be relied on to confine itself.

A new claim MUST start empty, including where an earlier claim had the same namespace and name.

Releasing a claim MUST leave the content of every other claim untouched.

## Snapshots

A cluster that runs [pgsnap](pgsnap.md) MUST offer a VolumeSnapshotClass named `ebs-retain` whose snapshots outlive the volume they were taken from.

## Reclaim

Releasing a claim MUST reclaim the space its content occupied.

> [!NOTE]
> A shared filesystem outlives every workload that holds a claim on it.
> Content left behind by a torn-down workload accrues cost with nothing referencing it and nobody watching it.

Where reclaim on release is enabled, a deployment MUST warn when the storage driver is not configured to perform it.

> [!NOTE]
> The setting reaches the driver through a layer that accepts a key it does not recognise instead of rejecting it.
> A cluster can therefore be configured for reclaim and quietly not perform it.

## Provisioning access

Whatever identity brings a workload up MUST be able to create and release that workload's claims.

> [!NOTE]
> A deployment describes its storage in the same manifest as the rest of the workload.
> An identity that can create the workload but not its claims fails partway, with the workload created and its claims refused.

## Protection

Shared filesystem content MUST be encrypted at rest.

A shared filesystem MUST accept connections only from the nodes of its own cluster.

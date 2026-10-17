---
id: K8SPGC
---

# PostgreSQL clusters

The requirements in this spec apply to every CloudNativePG cluster that the shared Kubernetes PostgreSQL component creates.
Memory-derived parameters follow the [pgtune](https://github.com/le0pard/pgtune) algorithm for a Linux OLTP workload on SSD storage, except where a requirement below differs.

## Borrowed terms

| term | meaning |
|---|---|
| cluster | A CloudNativePG `Cluster` resource, a PostgreSQL primary with its replicas ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). Within this spec the word never means a Kubernetes cluster. |
| instance pod | A pod running one PostgreSQL instance of a cluster ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). |
| disruption budget | A PodDisruptionBudget that the operator creates for a cluster ([Kubernetes disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/)). |
| switchover | The promotion of a replica to primary while the old primary is demoted, without data loss ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). |
| server parameters | The configuration parameters of PostgreSQL, such as `shared_buffers` ([PostgreSQL server configuration](https://www.postgresql.org/docs/current/runtime-config.html)). |

## Tuning basis

The [tuning basis](../overview.md#tuning-basis) of a cluster is the memory request declared for its instance pods.

Every memory-derived parameter MUST be computed from the tuning basis.

A host-level or node-level memory figure MUST NOT be used as a basis.

> [!NOTE]
> Instance pods share nodes with unrelated workloads and are scheduled against their requests.

A change to the memory request MUST change every memory-derived parameter, except where a floor or cap in this spec applies.

Tuning MUST NOT set a memory-derived parameter below the value PostgreSQL uses by default.

## Memory parameters

A cluster MUST set each parameter in the following table to the value given for it.

| parameter | value |
|---|---|
| `shared_buffers` | A quarter of the tuning basis. |
| `effective_cache_size` | Three quarters of the tuning basis. |
| `maintenance_work_mem` | A sixteenth of the tuning basis, at least 64MB and at most 8GB. |
| `work_mem` | The tuning basis less `shared_buffers`, divided by three times the sum of `max_connections` and 8, and at least 4MB. |
| `wal_buffers` | Three percent of `shared_buffers`, at least 32kB and at most 16MB, rounded up to 16MB where the computed value is between 14MB and 16MB. |
| `autovacuum_work_mem` | 2GB where `maintenance_work_mem` is 2GB or more, otherwise PostgreSQL's default of tracking `maintenance_work_mem`. |

## Storage-derived limits

A cluster MUST set each parameter in the following table to the value given for it.

| parameter | value |
|---|---|
| `temp_file_limit` | A quarter of the volume size of the cluster. |
| `max_slot_wal_keep_size` | Thirty percent of the volume size of the cluster, at least 1GB. |

## Workload parameters

A cluster MUST set each parameter in the following table to the value given for it.

| parameter | value |
|---|---|
| `random_page_cost` | `1.1` |
| `effective_io_concurrency` | `200` |
| `jit` | `off` |
| `wal_compression` | `lz4` |

## Connection hygiene

A backend MUST notice within ten seconds that its client has disconnected, including while it waits on a lock, and MUST abort its query.

A backend that waits on a lock for longer than the deadlock timeout MUST log the wait.

## Scheduling and disruption

A cluster MUST keep the operator's disruption budgets unless it opts out.

A cluster that opts out of its disruption budgets MUST let every node hosting its instances be drained, including the node holding its primary.

A cluster MUST be able to opt into the [critical database pool](../overview.md#critical-database-pool).

A cluster that opts into the critical database pool MUST run its instances only on that pool, each on its own node.

A cluster MUST be able to opt into on-demand placement.

A cluster that opts into on-demand placement MUST run its instances only on on-demand workload nodes outside the critical database pool, each on its own node.

A cluster that opts into neither the critical database pool nor on-demand placement MUST prefer spot capacity.

A cluster with more than one instance MUST update its primary by first promoting an already-updated replica through a switchover.

A cluster MUST NOT be reported ready to the resources that depend on it until its latest update has been accepted, its read-write service has a ready instance behind it, and its superuser credentials exist.

> [!NOTE]
> A dependent created against a cluster whose update was rejected, or before its credentials exist, waits indefinitely instead of failing.

Where a cluster archives to object storage, the archiving sidecar in each instance pod MUST declare CPU and memory requests.

## Parameters not derived

A parameter MUST NOT be derived from a CPU count.

> [!NOTE]
> Instance pods request a fraction of a core and share nodes with unrelated workloads, so no CPU figure available to a cluster describes what it can use.

A cluster MUST NOT enable huge pages unless its nodes preallocate them and its instance pods request them as a pod resource.

A cluster MUST NOT select the `io_uring` I/O method.

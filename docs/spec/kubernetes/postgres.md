# PostgreSQL clusters

This spec covers the configuration shared by every CloudNativePG cluster the
common Kubernetes PostgreSQL component creates: how performance parameters are
derived from the resources a cluster is given, and which parameters are
deliberately left alone.

The tuning follows the pgtune algorithm for a Linux OLTP workload on SSD
storage, the same lineage as the tuning the Ansible `postgres` role applies to
standalone servers. The two differ in their input: a standalone server shares
its memory with an application, a web server and a backup agent, and so holds
back a reserve, whereas a cluster instance pod runs nothing but PostgreSQL and
tunes against everything it is given.

## Tuning basis

k[postgres.tuning.basis]
Memory-derived parameters must be computed from the memory request declared for
a cluster's instance pods. No host-level or node-level memory figure may be
used as the basis, because instance pods share nodes with unrelated workloads
and are scheduled against their requests.

k[postgres.tuning.scales]
Every memory-derived parameter must change when a cluster's memory request
changes. No such parameter may hold a value fixed independently of the basis.

k[postgres.tuning.no-regression]
Tuning must never set a parameter below the value PostgreSQL would use by
default. The basis can be small enough for a pgtune ratio to fall under a
stock default, and in that case the stock default must win.

## Memory parameters

k[postgres.tuning.shared-buffers]
`shared_buffers` must be a quarter of the basis.

k[postgres.tuning.effective-cache-size]
`effective_cache_size` must be three quarters of the basis. It is a planner
hint rather than an allocation, and the page cache on the node backs it.

k[postgres.tuning.maintenance-work-mem]
`maintenance_work_mem` must be a sixteenth of the basis, capped at 8GB and
never below PostgreSQL's default of 64MB.

k[postgres.tuning.work-mem]
`work_mem` must be the basis less `shared_buffers`, divided by three times the
sum of `max_connections` and eight, and never below 4MB. The eight accounts
for the worker processes a backend may recruit. Because the divisor includes
`max_connections`, raising a cluster's connection limit lowers its `work_mem`
unless the memory request rises with it.

k[postgres.tuning.wal-buffers]
`wal_buffers` must be three percent of `shared_buffers`, bounded below by 32kB
and above by 16MB, and rounded up to 16MB when the computed value falls
between 14MB and 16MB.

k[postgres.tuning.autovacuum-work-mem]
`autovacuum_work_mem` must be capped at 2GB when `maintenance_work_mem`
reaches 2GB or more, and otherwise left at PostgreSQL's default of tracking
`maintenance_work_mem`.

## Storage-derived limits

k[postgres.tuning.temp-file-limit]
`temp_file_limit` must be a quarter of the cluster's volume size, so that a
single query spilling temporary files cannot fill the volume out from under
the cluster.

k[postgres.wal.slot-keep-size]
`max_slot_wal_keep_size` must be thirty percent of the cluster's volume size,
floored at 1GB. Replication slots retain WAL without bound by default, so a
stranded or long-lagging standby would otherwise fill the primary's volume; a
standby that falls further behind than this is re-cloned instead.

## Workload assumptions

k[postgres.tuning.ssd-costs]
`random_page_cost` must be 1.1 and `effective_io_concurrency` must be 200.
Cluster volumes are SSD-class network block storage, where a seek costs
little more than a sequential read and there is queue depth to exploit.

k[postgres.tuning.jit-off]
`jit` must be off. JIT compilation causes CPU spikes and slow planning on the
simple OLTP queries these clusters serve.

k[postgres.tuning.wal-compression]
`wal_compression` must be `lz4`, which roughly halves WAL volume on
full-page-write-heavy churn and so shrinks replication traffic, WAL I/O and
backup size at a lower CPU cost than the older `pglz`.

## Connection hygiene

k[postgres.client-check]
A backend must notice within ten seconds that its client has disconnected,
including while it waits on a lock, and abort its query. A client that gives
up on a blocked query otherwise leaves its backend waiting and holding a
connection slot; behind a connection pooler, which replaces the closed server
connection at once, such backends accumulate until the cluster runs out of
slots.

k[postgres.log-lock-waits]
A backend that waits on a lock for longer than the deadlock timeout must log
the wait, so that lock contention can be traced to the queries involved.

## Scheduling and disruption

k[postgres.disruption.opt-out]
A cluster must keep the operator's disruption budgets unless it opts out.
A cluster that opts out must let every node hosting its instances be drained,
including the node holding its primary, so that it never blocks node
consolidation.

k[postgres.placement.dedicated+2]
A cluster must be able to opt into the dedicated pool for critical databases.
A cluster that does must run its instances only on that pool, each on its own
node. Clusters that opt into neither this nor on-demand placement must keep
preferring spot capacity.

k[postgres.placement.on-demand+2]
A cluster must be able to opt into on-demand capacity.
A cluster that does must run its instances only on on-demand workload nodes,
outside the dedicated pool for critical databases, each on its own node.

k[postgres.primary-update.switchover]
A cluster with more than one instance must update its primary by first
promoting an already-updated replica, so that a rolling update never leaves it
without a primary.

k[postgres.readiness]
A cluster must be reported ready to the resources that depend on it only
after its own latest update has been accepted, its read-write service has a
ready instance behind it, and its superuser credentials exist. A dependent
created against a cluster whose update was rejected, or before its
credentials exist, waits indefinitely rather than failing.

k[postgres.backup-sidecar.requests]
When a cluster archives to object storage, the archiving sidecar in each
instance pod must declare CPU and memory requests, so that the scheduler
accounts for what it uses.

## Parameters left alone

k[postgres.tuning.no-cpu-derivation]
No parameter may be derived from a CPU count. Instance pods request a
fraction of a core and share nodes with unrelated workloads, so no CPU figure
available to a cluster describes what it can actually use, and CloudNativePG
sets `max_worker_processes` itself.

k[postgres.tuning.no-huge-pages]
Clusters must not enable huge pages. Huge pages must be preallocated on the
node and requested as a pod resource, and neither is provisioned.

k[postgres.tuning.no-io-uring]
Clusters must not select the `io_uring` I/O method. The container runtime's
default seccomp profile denies the io_uring syscalls, so enabling it would
require instance pods to give up that profile, and PostgreSQL's asynchronous
I/O covers reads, which cluster volumes serve almost entirely from the node's
page cache.

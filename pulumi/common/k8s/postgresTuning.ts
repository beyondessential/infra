// Performance tuning for CNPG clusters, derived from the resources each
// cluster is given. Follows the pgtune algorithm
// (https://github.com/le0pard/pgtune/blob/master/src/features/configuration/configurationSlice.js)
// for a Linux OLTP workload on SSD storage, the same lineage as
// ansible/roles/postgres/tasks/tune.yml.
//
// The Ansible role tunes against host RAM less a reserve, because those
// servers also run the app, Caddy and kopia. An instance pod runs nothing but
// PostgreSQL, so the basis here is the pod's whole memory request.
//
// Memory values are computed in kB and emitted with an explicit `kB` suffix:
// several of these settings have their own default unit (shared_buffers counts
// 8kB blocks, max_slot_wal_keep_size counts MB), so a unit-less integer would
// mean something different per parameter.

// Two settings the Ansible role tunes are absent here by design, and adding
// them would need more than a parameter.
//
// huge_pages needs pages preallocated on the node and requested as a pod
// resource; neither is provisioned.
// k[postgres.tuning.no-huge-pages]
//
// io_method=io_uring needs the io_uring syscalls, which containerd's default
// seccomp profile does not allow — and the kubelet applies that profile to
// every pod, so a cluster would have to run Unconfined to use it. It would buy
// nothing: PostgreSQL 18's async I/O covers reads, and cluster volumes serve
// reads from the node page cache almost entirely (median peak read IOPS of 1
// per volume, 99th percentile 701, against a gp3 ceiling of 3000).
// k[postgres.tuning.no-io-uring]

const KB = 1;
const MB = 1024 * KB;
const GB = 1024 * MB;

// pgtune divides the non-shared_buffers memory across connections plus the
// worker processes a backend may recruit. That second term is its
// `parallelForWorkMem`, which falls back to this default when parallel
// settings aren't emitted — which is always the case here, since nothing is
// derived from CPU counts.
// k[postgres.tuning.no-cpu-derivation]
const WORKERS_FOR_WORK_MEM = 8;

// PostgreSQL's own default, and the floor tuning must not go under.
const MAINTENANCE_WORK_MEM_DEFAULT = 64 * MB;

const QUANTITY_UNITS: Record<string, number> = {
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
};

// Kubernetes resource quantities carry their unit, and a cluster's memory and
// storage are written in whichever one suits. Parsing rather than assuming a
// unit keeps `500Mi` from being read as 500GiB.
export function parseQuantityToBytes(quantity: string): number {
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]*)$/.exec(quantity.trim());
  if (!match) throw new Error(`unparseable Kubernetes quantity: ${quantity}`);
  const multiplier = QUANTITY_UNITS[match[2]];
  if (multiplier === undefined) {
    throw new Error(`unknown unit ${match[2]} in Kubernetes quantity: ${quantity}`);
  }
  return Number(match[1]) * multiplier;
}

export interface PostgresTuningArgs {
  // Memory request of the instance pods, as a Kubernetes quantity.
  memory: string;
  // Volume size of the cluster, as a Kubernetes quantity.
  storage: string;
  maxConnections: number;
}

// k[postgres.tuning.basis] k[postgres.tuning.scales]
export function derivePostgresParameters({
  memory,
  storage,
  maxConnections,
}: PostgresTuningArgs): Record<string, string> {
  const ram = Math.floor(parseQuantityToBytes(memory) / 1024);
  const volume = Math.floor(parseQuantityToBytes(storage) / 1024);

  // k[postgres.tuning.shared-buffers]
  const sharedBuffers = Math.floor(ram / 4);

  // k[postgres.tuning.effective-cache-size]
  const effectiveCacheSize = Math.floor((ram * 3) / 4);

  // A sixteenth of the basis falls below PostgreSQL's own default on the
  // smaller clusters, where it would slow vacuums and index builds rather
  // than tune them.
  // k[postgres.tuning.maintenance-work-mem] k[postgres.tuning.no-regression]
  const maintenanceWorkMem = Math.max(
    MAINTENANCE_WORK_MEM_DEFAULT,
    Math.min(Math.floor(ram / 16), 8 * GB),
  );

  // k[postgres.tuning.work-mem] k[postgres.tuning.no-regression]
  const workMem = Math.max(
    4 * MB,
    Math.floor((ram - sharedBuffers) / ((maxConnections + WORKERS_FOR_WORK_MEM) * 3)),
  );

  const parameters: Record<string, string> = {
    // Pinned rather than left implicit because work_mem is divided by it: the
    // two have to agree on the same number.
    max_connections: `${maxConnections}`,

    shared_buffers: `${sharedBuffers}kB`,
    effective_cache_size: `${effectiveCacheSize}kB`,
    maintenance_work_mem: `${maintenanceWorkMem}kB`,
    work_mem: `${workMem}kB`,
    wal_buffers: `${deriveWalBuffers(sharedBuffers)}kB`,

    // Per-session cap, so a query spilling temp files can't fill the volume
    // out from under the cluster.
    // k[postgres.tuning.temp-file-limit]
    temp_file_limit: `${Math.floor(volume / 4)}kB`,

    // Replication slots retain WAL without bound by default, so a stranded or
    // long-lagging standby would fill the primary's volume. A replica that
    // falls further behind than this is re-cloned by CNPG instead.
    // k[postgres.wal.slot-keep-size]
    max_slot_wal_keep_size: `${Math.max(1 * GB, Math.floor(volume * 0.3))}kB`,

    // gp3 is SSD-class: seeks are nearly as cheap as sequential reads, and it
    // has queue depth to exploit. PostgreSQL 18's async I/O honours
    // effective_io_concurrency even where fadvise() is unavailable.
    // k[postgres.tuning.ssd-costs]
    random_page_cost: '1.1',
    effective_io_concurrency: '200',

    // JIT causes CPU spikes and slow planning on simple OLTP queries.
    // k[postgres.tuning.jit-off]
    jit: 'off',

    // Halves-ish WAL volume on full-page-write-heavy churn, which shrinks
    // replication traffic, pg_wal I/O and backup sizes.
    // k[postgres.tuning.wal-compression]
    wal_compression: 'lz4',
  };

  // Above 2GB, maintenance_work_mem is more than any one autovacuum worker
  // should claim; below it, tracking maintenance_work_mem is the right
  // default.
  // k[postgres.tuning.autovacuum-work-mem]
  if (maintenanceWorkMem >= 2 * GB) {
    parameters.autovacuum_work_mem = `${2 * GB}kB`;
  }

  return parameters;
}

// 3% of shared_buffers, bounded to [32kB, 16MB]. The window just under the
// upper bound rounds up instead: pgtune treats a value that close to 16MB as
// wanting the cap.
// k[postgres.tuning.wal-buffers]
function deriveWalBuffers(sharedBuffers: number): number {
  const raw = Math.floor((sharedBuffers * 3) / 100);
  if (raw > 14 * MB && raw < 16 * MB) return 16 * MB;
  return Math.max(32 * KB, Math.min(16 * MB, raw));
}

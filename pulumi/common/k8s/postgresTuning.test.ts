import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePostgresParameters, parseQuantityToBytes } from './postgresTuning.ts';

const MiB = 1024;
const GiB = 1024 * MiB;

// k[verify postgres.tuning.basis] k[verify postgres.tuning.scales]
// k[verify postgres.tuning.shared-buffers] k[verify postgres.tuning.effective-cache-size]
// k[verify postgres.tuning.work-mem]
test('memory parameters scale with the basis', () => {
  const sizes = [
    { memory: '750Mi', maxConnections: 100, sharedBuffers: 187 * MiB + 512, workMem: 4 * MiB },
    { memory: '2Gi', maxConnections: 200, sharedBuffers: 512 * MiB, workMem: 4 * MiB },
    { memory: '8Gi', maxConnections: 200, sharedBuffers: 2 * GiB, workMem: 10082 },
  ];

  for (const { memory, maxConnections, sharedBuffers, workMem } of sizes) {
    const p = derivePostgresParameters({ memory, storage: '60Gi', maxConnections });
    assert.equal(p.shared_buffers, `${sharedBuffers}kB`, `shared_buffers at ${memory}`);
    assert.equal(p.effective_cache_size, `${sharedBuffers * 3}kB`, `cache size at ${memory}`);
    assert.equal(p.work_mem, `${workMem}kB`, `work_mem at ${memory}`);
    assert.equal(p.max_connections, `${maxConnections}`);
  }
});

// A quarter of the basis, and three quarters for the planner hint.
// k[verify postgres.tuning.shared-buffers] k[verify postgres.tuning.effective-cache-size]
test('shared_buffers is a quarter of the basis and cache size three quarters', () => {
  const p = derivePostgresParameters({ memory: '4Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(p.shared_buffers, `${1 * GiB}kB`);
  assert.equal(p.effective_cache_size, `${3 * GiB}kB`);
});

// k[verify postgres.tuning.maintenance-work-mem] k[verify postgres.tuning.no-regression]
test('maintenance_work_mem is a sixteenth of the basis but never below the stock default', () => {
  // A sixteenth of 750Mi is 48MB, under PostgreSQL's 64MB default.
  const small = derivePostgresParameters({ memory: '750Mi', storage: '10Gi', maxConnections: 100 });
  assert.equal(small.maintenance_work_mem, `${64 * MiB}kB`);

  const large = derivePostgresParameters({ memory: '2Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(large.maintenance_work_mem, `${128 * MiB}kB`);

  // Capped at 8GB: a sixteenth of 256Gi would be 16GB.
  const huge = derivePostgresParameters({ memory: '256Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(huge.maintenance_work_mem, `${8 * GiB}kB`);
});

// k[verify postgres.tuning.work-mem] k[verify postgres.tuning.no-regression]
test('work_mem divides remaining memory across connections, floored at 4MB', () => {
  // (8Gi - 2Gi) / ((200 + 8) * 3) = 10082kB, comfortably above the floor.
  const roomy = derivePostgresParameters({ memory: '8Gi', storage: '10Gi', maxConnections: 200 });
  assert.equal(roomy.work_mem, '10082kB');

  // Same memory, five times the connections: the floor takes over.
  const crowded = derivePostgresParameters({
    memory: '8Gi',
    storage: '10Gi',
    maxConnections: 1000,
  });
  assert.equal(crowded.work_mem, `${4 * MiB}kB`);
});

// k[verify postgres.tuning.wal-buffers]
test('wal_buffers is 3% of shared_buffers, bounded and snapped near the cap', () => {
  // 3% of 187.5MiB = 5760kB, well inside the bounds.
  const below = derivePostgresParameters({ memory: '750Mi', storage: '10Gi', maxConnections: 100 });
  assert.equal(below.wal_buffers, '5760kB');

  // 3% of 466.5MiB = 14330kB, just under the 14MB snap window.
  const under = derivePostgresParameters({ memory: '1866Mi', storage: '10Gi', maxConnections: 100 });
  assert.equal(under.wal_buffers, '14330kB');

  // 3% of 512MiB = 15728kB, inside the window, so it rounds up to the cap.
  const snapped = derivePostgresParameters({ memory: '2Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(snapped.wal_buffers, `${16 * MiB}kB`);

  // 3% of 2GiB = 62914kB, over the cap.
  const capped = derivePostgresParameters({ memory: '8Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(capped.wal_buffers, `${16 * MiB}kB`);
});

// k[verify postgres.tuning.autovacuum-work-mem]
test('autovacuum_work_mem is only capped once maintenance_work_mem reaches 2GB', () => {
  const under = derivePostgresParameters({ memory: '8Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(under.autovacuum_work_mem, undefined);

  // A sixteenth of 32Gi is exactly 2GB.
  const at = derivePostgresParameters({ memory: '32Gi', storage: '10Gi', maxConnections: 100 });
  assert.equal(at.autovacuum_work_mem, `${2 * GiB}kB`);
});

// k[verify postgres.tuning.temp-file-limit]
test('temp_file_limit is a quarter of the volume', () => {
  const p = derivePostgresParameters({ memory: '750Mi', storage: '60Gi', maxConnections: 100 });
  assert.equal(p.temp_file_limit, `${15 * GiB}kB`);
});

// k[verify postgres.wal.slot-keep-size]
test('max_slot_wal_keep_size is 30% of the volume, floored at 1GB', () => {
  const large = derivePostgresParameters({ memory: '750Mi', storage: '60Gi', maxConnections: 100 });
  assert.equal(large.max_slot_wal_keep_size, `${18 * GiB}kB`);

  // 30% of 2Gi is 629MB, under the floor.
  const small = derivePostgresParameters({ memory: '750Mi', storage: '2Gi', maxConnections: 100 });
  assert.equal(small.max_slot_wal_keep_size, `${1 * GiB}kB`);
});

// k[verify postgres.tuning.ssd-costs] k[verify postgres.tuning.jit-off]
// k[verify postgres.tuning.wal-compression]
test('workload assumptions are fixed regardless of size', () => {
  for (const memory of ['750Mi', '8Gi']) {
    const p = derivePostgresParameters({ memory, storage: '10Gi', maxConnections: 100 });
    assert.equal(p.random_page_cost, '1.1');
    assert.equal(p.effective_io_concurrency, '200');
    assert.equal(p.jit, 'off');
    assert.equal(p.wal_compression, 'lz4');
  }
});

// k[verify postgres.tuning.no-cpu-derivation] k[verify postgres.tuning.no-huge-pages]
// k[verify postgres.tuning.no-io-uring]
test('parameters that must be left alone are not emitted', () => {
  const p = derivePostgresParameters({ memory: '32Gi', storage: '60Gi', maxConnections: 200 });
  for (const parameter of [
    'huge_pages',
    'io_method',
    'io_workers',
    'max_worker_processes',
    'max_parallel_workers',
    'max_parallel_workers_per_gather',
    'max_parallel_maintenance_workers',
  ]) {
    assert.equal(p[parameter], undefined, `${parameter} must not be set`);
  }
});

test('quantities are parsed by their declared unit', () => {
  assert.equal(parseQuantityToBytes('750Mi'), 750 * 1024 ** 2);
  assert.equal(parseQuantityToBytes('8Gi'), 8 * 1024 ** 3);
  assert.equal(parseQuantityToBytes('1G'), 1e9);
  assert.equal(parseQuantityToBytes('1Ki'), 1024);
  assert.equal(parseQuantityToBytes('4096'), 4096);
  assert.equal(parseQuantityToBytes('1.5Gi'), 1.5 * 1024 ** 3);

  // A mebibyte volume must not be read as a gibibyte one.
  assert.notEqual(parseQuantityToBytes('500Mi'), parseQuantityToBytes('500Gi'));

  assert.throws(() => parseQuantityToBytes('banana'), /unparseable/);
  assert.throws(() => parseQuantityToBytes('5Xi'), /unknown unit/);
});

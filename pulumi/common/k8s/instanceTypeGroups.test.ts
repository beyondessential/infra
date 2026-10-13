import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  instancesForRegion,
  memoryDenseSizedAtLeast,
  spotInterruptAtMost,
  type RegionInstance,
} from './instanceTypeGroups.ts';

function instance(instance_type: string, spotInterruptMax?: number): RegionInstance {
  return {
    placement_group_support: true,
    pretty_name: instance_type,
    physical_processor: '',
    arch: ['arm64'],
    instance_type,
    family: '',
    linuxPricing: { ondemand: 1, spot: 0.5, spotInterruptMax },
    windowsPricing: { ondemand: Infinity, spot: Infinity },
    burst_minutes: null,
    vCPU: 4,
    memory: 16,
  };
}

// k[verify capacity.spot-interruption-cap]
test('spot types above the interruption ceiling or without data are dropped', () => {
  const kept = spotInterruptAtMost(
    [instance('a', 5), instance('b', 10), instance('c', 15), instance('d', 100), instance('e')],
    'linux',
    10,
  );
  assert.deepEqual(
    kept.map((i) => i.instance_type),
    ['a', 'b'],
  );
});

// k[verify capacity.spot-interruption-cap]
test('advisor bands parse to their upper bound', () => {
  const bands = new Set(
    instancesForRegion('ap-southeast-2', { highMemory: true })
      .map((i) => i.linuxPricing.spotInterruptMax)
      .filter((b) => b !== undefined),
  );
  assert.ok(bands.size > 0, 'instances.json carries interruption bands');
  for (const b of bands) assert.ok([5, 10, 15, 20, 100].includes(b!), `unexpected band ${b}`);
});

// k[verify capacity.workload-node-floor]
test('memory-dense shapes down to 2 vCPU / 32 GiB are admitted, nothing else below the floor', () => {
  const types = memoryDenseSizedAtLeast('ap-southeast-2', 'arm64', 2, 32).map(
    (i) => i.instance_type,
  );
  assert.ok(types.includes('x8g.large'));
  assert.ok(!types.includes('x8g.medium'));
  assert.ok(!types.some((t) => /^[cmt]/.test(t)));
});

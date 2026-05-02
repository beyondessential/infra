import * as k8s from '@pulumi/kubernetes';
import { cfg } from '../../common/coreRef.ts';
import { provider } from '../kubeconfig.ts';
import { region } from '../../common/awsAccount.ts';
import {
  upToMonthly,
  spotWithinOnDemandPrice,
  nonBurst,
  onlyBurst,
  instancesSizedAtLeast,
} from '../../common/k8s/instanceTypeGroups.ts';
import { workloadNodeClass, ingressNodeClass, systemNodeClass } from './classes.ts';

// Whether to add a spot system NodePool alongside the on-demand one. Pre-Phase
// 7 the same config also picks managed-nodegroup capacity for system; the
// semantic ("I want my system on spot when possible") carries over.
const systemSpot = cfg.getBoolean('systemSpot') ?? false;

// Instance type lists, mirroring what nodes/groups.ts uses for the equivalent
// managed nodegroups. The helpers price-cap spot against on-demand and exclude
// burstable types from large workload pools.

// k[capacity.spot-price-cap] k[capacity.no-burstable-large]
const workloadArmSpot = upToMonthly(
  spotWithinOnDemandPrice(nonBurst(instancesSizedAtLeast(region, 'arm64', 4, 16)), 'linux'),
  'linux',
  'spot',
  100,
).map((i) => i.instance_type);

const workloadX86Spot = upToMonthly(
  spotWithinOnDemandPrice(nonBurst(instancesSizedAtLeast(region, 'x86_64', 4, 8)), 'linux'),
  'linux',
  'spot',
  75,
).map((i) => i.instance_type);

const workloadArmOndemand = upToMonthly(
  instancesSizedAtLeast(region, 'arm64', 2, 4),
  'linux',
  'ondemand',
  75,
).map((i) => i.instance_type);

const workloadX86Ondemand = upToMonthly(
  instancesSizedAtLeast(region, 'x86_64', 2, 4),
  'linux',
  'ondemand',
  75,
).map((i) => i.instance_type);

const ingressArm = upToMonthly(
  spotWithinOnDemandPrice(nonBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)), 'linux'),
  'linux',
  'spot',
  50,
).map((i) => i.instance_type);

const systemArm = upToMonthly(
  onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
  'linux',
  'ondemand',
  100,
).map((i) => i.instance_type);

const systemArmSpot = upToMonthly(
  spotWithinOnDemandPrice(onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)), 'linux'),
  'linux',
  'spot',
  100,
).map((i) => i.instance_type);

// k[lifecycle.disruption-budgets]
// Budgets cap how many nodes Karpenter can disrupt at once for consolidation,
// drift, or empty-cleanup. `schedule` + `duration` create freeze windows
// (cron + duration); leaving them off makes the budget always-on.
interface DisruptionBudget {
  nodes: string; // count or percentage, e.g. "1" or "10%"
  reasons?: ('Underutilized' | 'Empty' | 'Drifted')[];
  schedule?: string;
  duration?: string;
}

interface PoolArgs {
  purpose: 'workload' | 'ingress' | 'system';
  schedule: 'spot' | 'ondemand' | 'mixed';
  arch: 'arm64' | 'amd64';
  nodeClassRef: k8s.apiextensions.CustomResource;
  instanceTypes: string[];
  weight: number;
  consolidateAfter?: string;
  consolidationPolicy?: 'WhenEmpty' | 'WhenEmptyOrUnderutilized';
  spotTaint?: boolean;
  capacityTypes: ('spot' | 'on-demand')[];
  limits: { cpu: number; memory: string };
  budgets?: DisruptionBudget[];
}

function pool(name: string, args: PoolArgs) {
  const {
    purpose,
    schedule,
    arch,
    nodeClassRef,
    instanceTypes,
    weight,
    consolidateAfter = '5m',
    consolidationPolicy = 'WhenEmptyOrUnderutilized',
    spotTaint = false,
    capacityTypes,
    limits,
    budgets,
  } = args;

  return new k8s.apiextensions.CustomResource(
    `nodepool-${name}`,
    {
      apiVersion: 'karpenter.sh/v1',
      kind: 'NodePool',
      metadata: { name },
      spec: {
        template: {
          metadata: {
            // k[node.label.purpose] k[node.label.schedule] k[node.label.arch] k[node.label.group]
            labels: {
              'bes.node.purpose': purpose,
              'bes.node.schedule': schedule === 'mixed' ? 'spot' : schedule,
              'bes.node.arch': arch,
              'bes.node.group': name,
            },
          },
          spec: {
            nodeClassRef: {
              group: 'karpenter.k8s.aws',
              kind: 'EC2NodeClass',
              name: nodeClassRef.metadata.name,
            },
            requirements: [
              { key: 'kubernetes.io/arch', operator: 'In', values: [arch] },
              { key: 'karpenter.sh/capacity-type', operator: 'In', values: capacityTypes },
              { key: 'node.kubernetes.io/instance-type', operator: 'In', values: instanceTypes },
            ],
            // k[node.taint.spot]
            taints: spotTaint
              ? [{ key: 'spotInstance', value: 'true', effect: 'PreferNoSchedule' }]
              : [],
          },
        },
        limits,
        // k[lifecycle.consolidation]
        disruption: { consolidationPolicy, consolidateAfter, ...(budgets ? { budgets } : {}) },
        weight,
      },
    },
    { provider, dependsOn: [nodeClassRef] },
  );
}

// Weights mirror autoscaler.ts:271 priority-expander order:
// arm-spot-large=80 > spot-large=60 > ingress-arm=50 > system-arm=40 > arm=30 > others=10

// k[capacity.workload-spot-preferred]
pool('workload-arm-spot', {
  purpose: 'workload',
  schedule: 'spot',
  arch: 'arm64',
  nodeClassRef: workloadNodeClass,
  instanceTypes: workloadArmSpot,
  capacityTypes: ['spot'],
  spotTaint: true,
  limits: { cpu: 1000, memory: '2000Gi' },
  weight: 80,
});

pool('workload-x86-spot', {
  purpose: 'workload',
  schedule: 'spot',
  arch: 'amd64',
  nodeClassRef: workloadNodeClass,
  instanceTypes: workloadX86Spot,
  capacityTypes: ['spot'],
  spotTaint: true,
  limits: { cpu: 500, memory: '1000Gi' },
  weight: 60,
});

pool('workload-arm-ondemand', {
  purpose: 'workload',
  schedule: 'ondemand',
  arch: 'arm64',
  nodeClassRef: workloadNodeClass,
  instanceTypes: workloadArmOndemand,
  capacityTypes: ['on-demand'],
  limits: { cpu: 500, memory: '1000Gi' },
  weight: 30,
});

pool('workload-x86-ondemand', {
  purpose: 'workload',
  schedule: 'ondemand',
  arch: 'amd64',
  nodeClassRef: workloadNodeClass,
  instanceTypes: workloadX86Ondemand,
  capacityTypes: ['on-demand'],
  limits: { cpu: 500, memory: '1000Gi' },
  weight: 10,
});

// Slower consolidation for ingress — LB target churn is expensive. The fleet
// is small (typically 2-3 nodes), so a percentage budget rounds badly; cap to
// one node at a time.
pool('ingress-arm', {
  purpose: 'ingress',
  schedule: 'mixed',
  arch: 'arm64',
  nodeClassRef: ingressNodeClass,
  instanceTypes: ingressArm,
  capacityTypes: ['spot', 'on-demand'],
  consolidateAfter: '10m',
  limits: { cpu: 100, memory: '200Gi' },
  weight: 50,
  budgets: [{ nodes: '1' }],
});

// k[capacity.system-stable-fallback]
// On-demand system pool — always present. Acts as the stable fallback for the
// autoscaler controller; if a spot pool is also enabled (below), this one
// catches anything spot can't satisfy.
pool('system-arm', {
  purpose: 'system',
  schedule: 'ondemand',
  arch: 'arm64',
  nodeClassRef: systemNodeClass,
  instanceTypes: systemArm,
  capacityTypes: ['on-demand'],
  consolidateAfter: '30m',
  consolidationPolicy: 'WhenEmpty',
  limits: { cpu: 50, memory: '100Gi' },
  weight: 40,
});

// Optional spot system pool, enabled by `systemSpot: true`. Higher weight than
// the on-demand pool so Karpenter prefers spot for new system pods. Weight
// only competes among system pools (other purposes are filtered by labels).
if (systemSpot) {
  pool('system-arm-spot', {
    purpose: 'system',
    schedule: 'spot',
    arch: 'arm64',
    nodeClassRef: systemNodeClass,
    instanceTypes: systemArmSpot,
    capacityTypes: ['spot'],
    spotTaint: true,
    consolidateAfter: '30m',
    consolidationPolicy: 'WhenEmpty',
    limits: { cpu: 50, memory: '100Gi' },
    weight: 45,
  });
}

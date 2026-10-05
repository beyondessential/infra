import * as k8s from '@pulumi/kubernetes';
import { provider } from '../kubeconfig.ts';
import { region } from '../../common/awsAccount.ts';
import {
  upToMonthly,
  spotWithinOnDemandPrice,
  nonBurst,
  onlyBurst,
  instancesSizedAtLeast,
  instancesSizedExactly,
} from '../../common/k8s/instanceTypeGroups.ts';
import {
  workloadNodeClass,
  dbReplicaNodeClass,
  ingressNodeClass,
  systemNodeClass,
  exitNodeClass,
} from './classes.ts';

// Instance type lists, mirroring what nodes/groups.ts uses for the equivalent
// managed nodegroups. The helpers price-cap spot against on-demand and exclude
// burstable types from large workload pools.

// k[capacity.spot-price-cap] k[capacity.no-burstable-large] k[capacity.workload-node-floor+2]
// Spot pools cast a wide net: lots of (instance-type, AZ) offerings so a per-AZ
// capacity drought in one family doesn't strand pods. Floor matches the spec
// minimum (4 vCPU / 8 GiB) and the price cap is sized to admit the 2xlarge
// shapes of the same families — Karpenter still picks the cheapest available
// offering, so larger shapes only land when smaller ones can't be provisioned.
// The x families are admitted here as more capacity for memory-heavy pods.
const workloadArmSpot = upToMonthly(
  spotWithinOnDemandPrice(
    nonBurst(instancesSizedAtLeast(region, 'arm64', 4, 8, { highMemory: true })),
    'linux',
  ),
  'linux',
  'spot',
  200,
).map((i) => i.instance_type);

const workloadX86Spot = upToMonthly(
  spotWithinOnDemandPrice(
    nonBurst(instancesSizedAtLeast(region, 'x86_64', 4, 8, { highMemory: true })),
    'linux',
  ),
  'linux',
  'spot',
  150,
).map((i) => i.instance_type);

// k[capacity.workload-node-floor+2]
// On-demand fallback pools offer exactly one node shape, family-diverse: a
// uniform shape can't fragment into many small nodes during spot droughts.
const workloadArmOndemand = upToMonthly(
  nonBurst(instancesSizedExactly(region, 'arm64', 4, 16)),
  'linux',
  'ondemand',
  200,
).map((i) => i.instance_type);

const workloadX86Ondemand = upToMonthly(
  nonBurst(instancesSizedExactly(region, 'x86_64', 4, 16)),
  'linux',
  'ondemand',
  200,
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

interface Taint {
  key: string;
  value: string;
  effect: 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';
}

interface PoolArgs {
  purpose: 'workload' | 'ingress' | 'system' | 'tailscale-exit';
  schedule: 'spot' | 'ondemand' | 'mixed';
  arch: 'arm64' | 'amd64';
  nodeClassRef: k8s.apiextensions.CustomResource;
  instanceTypes: string[];
  weight: number;
  consolidateAfter?: string;
  consolidationPolicy?: 'WhenEmpty' | 'WhenEmptyOrUnderutilized';
  spotTaint?: boolean;
  // Taints to dedicate the pool; tolerating pods must opt in explicitly.
  extraTaints?: Taint[];
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
    extraTaints = [],
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
            // k[node.label.purpose+2] k[node.label.schedule] k[node.label.arch] k[node.label.group]
            labels: {
              'bes.node.purpose': purpose,
              'bes.node.schedule': schedule === 'mixed' ? 'spot' : schedule,
              'bes.node.arch': arch,
              'bes.node.group': name,
            },
          },
          spec: {
            // rotate nodes at least every week, for patches and recosting
            expireAfter: '168h', // 7 days

            // how long do pods have to vacate before they're force-terminated
            terminationGracePeriod: '30m',

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
            taints: [
              ...(spotTaint
                ? [{ key: 'spotInstance', value: 'true', effect: 'PreferNoSchedule' }]
                : []),
              ...extraTaints,
            ],
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

// k[capacity.db-replica-pool] k[capacity.workload-node-floor+2] k[node.taint.spot]
// Dedicated pool for restored database replicas (pgro opts its pods in via its
// ConfigMap nodeSelector and tolerations). Replica demand is memory-heavy and
// near-idle on CPU, so the shapes are 1:8 and 1:16 Graviton sized for one
// replica per node, chosen for low spot interruption rates in ap-southeast-2:
// x8g as the primary, r6g.large as the diversification fallback. All sit far
// below on-demand price on spot. x8g is outside the general-purpose families
// the instanceTypeGroups helpers admit, hence the literal list. On-demand is
// allowed as a fallback so a spot drought delays nothing; Karpenter prefers
// spot when both are offered. Replica pods carry do-not-disrupt and are
// replaced on every restore cycle, so only empty nodes are ever reclaimed.
pool('db-replica', {
  purpose: 'workload',
  schedule: 'mixed',
  arch: 'arm64',
  nodeClassRef: dbReplicaNodeClass,
  instanceTypes: ['x8g.medium', 'x8g.large', 'r6g.large'],
  capacityTypes: ['spot', 'on-demand'],
  spotTaint: true,
  extraTaints: [{ key: 'bes.node.group', value: 'db-replica', effect: 'NoSchedule' }],
  consolidationPolicy: 'WhenEmpty',
  limits: { cpu: 100, memory: '1600Gi' },
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

// Spot system pool. Higher weight than the on-demand pool so Karpenter prefers
// spot for new system pods. Karpenter's controller is forced (via
// topologySpreadConstraints in controller.ts) to keep at least one replica on
// on-demand, so a spot capacity drought can't take all controllers down at
// once. Weight only competes among system pools (other purposes are filtered
// by labels).
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

// k[capacity.exit-node-dedicated]
// Dedicated single-node pool for the Tailscale exit node. On-demand only — it's
// a live network path, so a spot reclaim would blip routing for connected
// clients. Pinned to the smallest burstable arm shapes that fit the exit node
// plus the daemonsets that ride every node; peak usage is ~0.2 vCPU / ~220MiB,
// dwarfed by the daemonset floor. The NoSchedule taint keeps all other
// workloads off; the exit node tolerates it and selects this pool via its
// ProxyClass (see k8s-essentials/tailscale.ts). WhenEmpty consolidation avoids
// churning the node just because it looks underutilised.
pool('tailscale-exit', {
  purpose: 'tailscale-exit',
  schedule: 'ondemand',
  arch: 'arm64',
  nodeClassRef: exitNodeClass,
  instanceTypes: ['t4g.small', 't4g.medium'],
  capacityTypes: ['on-demand'],
  extraTaints: [{ key: 'bes.node.purpose', value: 'tailscale-exit', effect: 'NoSchedule' }],
  consolidateAfter: '30m',
  consolidationPolicy: 'WhenEmpty',
  limits: { cpu: 4, memory: '8Gi' },
  weight: 10,
});

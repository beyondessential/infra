import * as k8s from '@pulumi/kubernetes';
import { region } from '../../common/k8s/coreRef.ts';
import {
  upToMonthly,
  spotWithinOnDemandPrice,
  nonBurst,
  instancesSizedAtLeast,
} from '../../common/k8s/instanceTypeGroups.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';
import { buildNodeClass } from './nodeClass.ts';
import {
  architectures,
  archSeg,
  nodeMinVcpu,
  nodeMinMemGi,
  spotMonthlyCap,
  ondemandMonthlyCap,
  consolidateAfter,
  maxBuilders,
} from './config.ts';

// The taint that dedicates build nodes; builder pods tolerate it, nothing else
// schedules here. Shared with builders.ts.
export const BUILD_TAINT = { key: 'bes.node.purpose', value: 'build', effect: 'NoSchedule' as const };

// k8s/node-label arch ('amd64'|'arm64') -> instance-catalogue arch string.
const INSTANCE_ARCH: Record<Architecture, string> = { amd64: 'x86_64', arm64: 'arm64' };

function instanceTypes(arch: Architecture, launch: 'spot' | 'ondemand', cap: number) {
  return region.apply((r) => {
    const sized = nonBurst(instancesSizedAtLeast(r, INSTANCE_ARCH[arch], nodeMinVcpu, nodeMinMemGi));
    const priced = launch === 'spot' ? spotWithinOnDemandPrice(sized, 'linux') : sized;
    return upToMonthly(priced, 'linux', launch, cap).map((i) => i.instance_type);
  });
}

function buildPool(arch: Architecture, launch: 'spot' | 'ondemand', weight: number) {
  const name = `build-${archSeg[arch]}-${launch}`;
  const capacityType = launch === 'spot' ? 'spot' : 'on-demand';
  const cap = launch === 'spot' ? spotMonthlyCap : ondemandMonthlyCap;

  return new k8s.apiextensions.CustomResource(
    `nodepool-${name}`,
    {
      apiVersion: 'karpenter.sh/v1',
      kind: 'NodePool',
      metadata: { name },
      spec: {
        template: {
          metadata: {
            labels: {
              'bes.node.purpose': 'build',
              'bes.node.schedule': launch === 'spot' ? 'spot' : 'ondemand',
              'bes.node.arch': arch,
              'bes.node.group': name,
            },
          },
          spec: {
            // Weekly rotation for patches/recosting, same as workload nodes.
            expireAfter: '168h',
            terminationGracePeriod: '30m',
            nodeClassRef: {
              group: 'karpenter.k8s.aws',
              kind: 'EC2NodeClass',
              name: buildNodeClass.metadata.name,
            },
            requirements: [
              { key: 'kubernetes.io/arch', operator: 'In', values: [arch] },
              { key: 'karpenter.sh/capacity-type', operator: 'In', values: [capacityType] },
              {
                key: 'node.kubernetes.io/instance-type',
                operator: 'In',
                values: instanceTypes(arch, launch, cap),
              },
            ],
            taints: [
              ...(launch === 'spot'
                ? [{ key: 'spotInstance', value: 'true', effect: 'PreferNoSchedule' }]
                : []),
              BUILD_TAINT,
            ],
          },
        },
        // Cap the pool's total capacity at maxBuilders nodes' worth (each builder
        // fills roughly one nodeMin-sized node). Bounds cost / blast radius.
        limits: { cpu: maxBuilders * nodeMinVcpu, memory: `${maxBuilders * nodeMinMemGi}Gi` },
        // WhenEmpty (not WhenEmptyOrUnderutilized): never disrupt a node that's
        // running a build just to repack for cost — only reclaim it once it's
        // idle. consolidateAfter is the idle-reuse window (see config.ts): idle
        // build nodes linger this long for warm reuse, then shut down.
        disruption: { consolidationPolicy: 'WhenEmpty', consolidateAfter },
        weight,
      },
    },
    { dependsOn: [buildNodeClass] },
  );
}

// Prefer spot (higher weight); on-demand pool is the spot-drought fallback.
export const pools = architectures.flatMap((arch) => [
  buildPool(arch, 'spot', 70),
  buildPool(arch, 'ondemand', 20),
]);

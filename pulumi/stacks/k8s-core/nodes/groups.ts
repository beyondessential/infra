import * as aws from '@pulumi/aws-native';
import { $network, cfg } from '../../common/coreRef.ts';
import { nodeRole } from '../roles.ts';
import { clusterName, tags } from '../cluster.ts';
import { region } from '../../common/awsAccount.ts';
import {
  upToMonthly,
  spotWithinOnDemandPrice,
  nonBurst,
  onlyBurst,
  instancesSizedAtLeast,
} from '../../common/k8s/instanceTypeGroups.ts';
import { Output } from '@pulumi/pulumi';

// Limit the number of AZs to use for node groups (default: use all available)
const azLimit = cfg.getNumber('azLimit');

// Use spot instances for system nodes (default: false, uses on-demand)
const systemSpot = cfg.getBoolean('systemSpot') ?? false;

// Whether HNC is enabled - if false, skip x86 system nodes (default: true)
const hncEnabled = cfg.getBoolean('hncEnabled') ?? true;

// Create a standard set of initially-empty node groups for workload autoscaling:
// - on-demand ARM64 nodes
// - on-demand x86 nodes
// - spot ARM64 nodes
// - spot x86 nodes
//
// and a standard set of initially-provisioned node groups for system workloads:
// - smaller burstable ARM64 in nat subnets for ingresses
// - smaller burstable ARM64 in workload subnets for storage, autoscaling, etc
//
// Additional node groups can be added by setting the `nodeGroups` config, and
// the standard set can be disabled by setting `standardNodeGroups` to false.

export interface NodeGroup {
  groupName: string;
  purpose: 'workload' | 'ingress' | 'system';
  schedule: 'ondemand' | 'spot';
  arch: 'amd64' | 'arm64';
  instanceTypes: string[] | Output<string[]>;
  minPerAz?: number;
  maxPerAz: number;
  initial?: number;
  amiType?: string;
  diskSize?: number;
}

const standardGroups: NodeGroup[] =
  cfg.getBoolean('standardNodeGroups') === false
    ? []
    : [
        {
          groupName: 'workload-arm-ondemand-small-v2',
          purpose: 'workload',
          schedule: 'ondemand',
          arch: 'arm64',
          amiType: 'BOTTLEROCKET_ARM_64',
          diskSize: 25,
          instanceTypes: upToMonthly(
            instancesSizedAtLeast(region, 'arm64', 2, 4),
            'linux',
            'ondemand',
            75,
          ).map((i) => i.instance_type),
          maxPerAz: 30,
        },
        {
          groupName: 'workload-x86-ondemand-small-v2',
          purpose: 'workload',
          schedule: 'ondemand',
          arch: 'amd64',
          amiType: 'BOTTLEROCKET_x86_64',
          diskSize: 25,
          instanceTypes: upToMonthly(
            instancesSizedAtLeast(region, 'x86_64', 2, 4),
            'linux',
            'ondemand',
            75,
          ).map((i) => i.instance_type),
          maxPerAz: 30,
        },
        {
          groupName: 'workload-arm-spot-large-v3',
          purpose: 'workload',
          schedule: 'spot',
          arch: 'arm64',
          amiType: 'BOTTLEROCKET_ARM_64',
          diskSize: 50,
          instanceTypes: upToMonthly(
            spotWithinOnDemandPrice(
              nonBurst(instancesSizedAtLeast(region, 'arm64', 4, 16)),
              'linux',
            ),
            'linux',
            'spot',
            100,
          ).map((i) => i.instance_type),
          maxPerAz: 30,
        },
        {
          groupName: 'workload-x86-spot-large-v2',
          purpose: 'workload',
          schedule: 'spot',
          arch: 'amd64',
          amiType: 'BOTTLEROCKET_x86_64',
          diskSize: 50,
          instanceTypes: upToMonthly(
            spotWithinOnDemandPrice(
              nonBurst(instancesSizedAtLeast(region, 'x86_64', 4, 8)),
              'linux',
            ),
            'linux',
            'spot',
            75,
          ).map((i) => i.instance_type),
          maxPerAz: 30,
        },
        {
          groupName: 'ingress-arm-spot-v2',
          purpose: 'ingress',
          schedule: 'spot',
          arch: 'arm64',
          amiType: 'BOTTLEROCKET_ARM_64',
          diskSize: 25,
          instanceTypes: upToMonthly(
            spotWithinOnDemandPrice(
              nonBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
              'linux',
            ),
            'linux',
            'spot',
            50,
          ).map((i) => i.instance_type),
          maxPerAz: 10,
        },
        {
          groupName: 'ingress-arm-ondemand-v3',
          purpose: 'ingress',
          schedule: 'ondemand',
          arch: 'arm64',
          amiType: 'BOTTLEROCKET_ARM_64',
          diskSize: 25,
          instanceTypes: upToMonthly(
            instancesSizedAtLeast(region, 'arm64', 2, 8),
            'linux',
            'ondemand',
            100,
          ).map((i) => i.instance_type),
          maxPerAz: 10,
        },
        {
          groupName: systemSpot ? 'system-arm-spot-v1' : 'system-arm-v2',
          purpose: 'system',
          schedule: systemSpot ? 'spot' : 'ondemand',
          arch: 'arm64',
          amiType: 'BOTTLEROCKET_ARM_64',
          diskSize: 25,
          instanceTypes: systemSpot
            ? upToMonthly(
                spotWithinOnDemandPrice(
                  onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
                  'linux',
                ),
                'linux',
                'spot',
                100,
              ).map((i) => i.instance_type)
            : upToMonthly(
                onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
                'linux',
                'ondemand',
                100,
              ).map((i) => i.instance_type),
          minPerAz: 1,
          maxPerAz: 10,
        },
        // x86 system nodes are only needed for HNC (which requires x86)
        ...(hncEnabled
          ? [
              {
                groupName: 'system-x86-v2',
                purpose: 'system' as const,
                schedule: 'spot' as const,
                arch: 'amd64' as const,
                amiType: 'BOTTLEROCKET_x86_64',
                diskSize: 25,
                instanceTypes: upToMonthly(
                  spotWithinOnDemandPrice(
                    nonBurst(instancesSizedAtLeast(region, 'x86_64', 2, 4)),
                    'linux',
                  ),
                  'linux',
                  'spot',
                  40,
                ).map((i) => i.instance_type),
                minPerAz: 0,
                maxPerAz: 10,
              },
            ]
          : []),
      ];

for (const {
  groupName,
  purpose,
  instanceTypes,
  arch,
  schedule,
  minPerAz = 0,
  maxPerAz,
  initial,
  amiType = null,
  diskSize = 100,
} of [...standardGroups, ...(cfg.getObject<NodeGroup[]>('nodeGroups') ?? [])]) {
  const allSubnets = purpose === 'ingress' ? $network.natSubnetIds : $network.workloadSubnetIds;
  allSubnets.apply((subnets) => {
    const limitedSubnets = azLimit ? subnets.slice(0, azLimit) : subnets;
    limitedSubnets.forEach((subnet, az0) => {
      const az = az0 + 1;
      new aws.eks.Nodegroup(
        `${groupName}-az${az}`,
        {
          clusterName,
          nodeRole: nodeRole.arn,
          subnets: [subnet],
          capacityType: schedule === 'ondemand' ? 'ON_DEMAND' : 'SPOT',
          amiType: amiType ?? (arch === 'arm64' ? 'AL2_ARM_64' : 'AL2_x86_64'),
          instanceTypes,
          diskSize,
          nodeRepairConfig: {
            enabled: true,
          },
          scalingConfig: {
            minSize: minPerAz,
            desiredSize: initial ?? minPerAz,
            maxSize: maxPerAz,
          },
          taints:
            schedule === 'ondemand'
              ? []
              : [
                  {
                    key: 'spotInstance',
                    value: 'true',
                    effect: 'PREFER_NO_SCHEDULE',
                  },
                ],
          updateConfig: maxPerAz >= 5 ? { maxUnavailablePercentage: 20 } : { maxUnavailable: 1 },
          labels: {
            'bes.node.group': groupName,
            'bes.node.purpose': purpose,
            'bes.node.schedule': schedule,
            'bes.node.arch': arch,
          },
          tags: {
            EKSCluster: clusterName, // for IAM permissions

            // for billing:
            ...tags,
            Purpose: `k8s-${purpose}`,

            'k8s.io/cluster-autoscaler/enabled': 'true', // for autodiscovery (value doesn't matter)
            'k8s.io/cluster-autoscaler/cluster': clusterName, // for autodiscovery
            'k8s.io/cluster-autoscaler/node-template/resources/ephemeral-storage': `${Math.max(5, diskSize - 5)}G`,

            ...(schedule === 'ondemand'
              ? {}
              : {
                  // Used by the cluster-autoscaler to prefer spot instances
                  'k8s.io/cluster-autoscaler/node-template/taint/spotInstance':
                    'true:PreferNoSchedule',
                }),

            // These labels can be used to target specific node groups for workloads
            // and will be understood by the auto-scaler for min=0 node groups.
            'k8s.io/cluster-autoscaler/node-template/label/bes.node.group': groupName,
            'k8s.io/cluster-autoscaler/node-template/label/bes.node.purpose': purpose,
            'k8s.io/cluster-autoscaler/node-template/label/bes.node.schedule': schedule,
            'k8s.io/cluster-autoscaler/node-template/label/bes.node.arch': arch,
          },
        },
        {
          // to recreate nodegroups, bump their version in the groupName.
          // more gracefully, copy the old nodegroup with a new version, up,
          // and then delete the old one in a subsequent up.
          ignoreChanges: ['instanceTypes', 'scalingConfig.desiredSize'],
          deleteBeforeReplace: false,
        },
      );
    });
  });
}

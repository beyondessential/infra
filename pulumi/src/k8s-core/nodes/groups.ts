import * as aws from '@pulumi/aws-native';
import { $network, cfg } from '../../common/coreRef.js';
import { nodeRole } from '../roles.js';
import { clusterName, tags } from '../cluster.js';

// Create a standard set of initially-empty node groups for workload autoscaling:
// - 0-10 on-demand ARM64 nodes
// - 0-10 on-demand x86 nodes
// - 0-10 spot ARM64 nodes
// - 0-10 spot x86 nodes
//
// and a standard set of initially-provisioned node groups for system workloads:
// - 2-4 small burstable ARM64 in nat subnets for ingresses
// - 2-4 small burstable ARM64 in workload subnets for storage, autoscaling, etc
//
// That gives us a minimum cost per month of $155 ($75 for the control plane,
// $20 each for reserved t4g.small), plus the cost of any workload nodes we need.
//
// Additional node groups can be added by setting the `nodeGroups` config, and
// the standard set can be disabled by setting `standardNodeGroups` to false.

export interface NodeGroup {
  groupName?: string;
  purpose: 'workload' | 'ingress' | 'system';
  schedule: 'ondemand' | 'spot';
  instanceTypes: string[];
  min: number;
  max: number;
  initial?: number;
}

const standardGroups: NodeGroup[] =
  cfg.getBoolean('standardNodeGroups') === false
    ? []
    : [
        {
          purpose: 'workload',
          schedule: 'ondemand',
          instanceTypes: ['a1.large'],
          min: 0,
          max: 30,
        },
        {
          purpose: 'workload',
          schedule: 'ondemand',
          instanceTypes: ['t3a.medium'],
          min: 0,
          max: 30,
        },
        {
          purpose: 'workload',
          schedule: 'spot',
          instanceTypes: [
            // 10 arm64 instances that are a1.large (2c/4g) or larger
            // under the on-demand price of a1.large
            // in linux spot price order
            't4g.medium',
            'a1.large',
            't4g.large',
            'a1.xlarge',
            'c6g.large',
            'm6g.large',
            'c7g.large',
            'r6g.large',
            'm7g.large',
            'r7g.large',
          ],
          min: 0,
          max: 30,
        },
        {
          purpose: 'workload',
          schedule: 'spot',
          instanceTypes: [
            // 10 nitro x86 instances that are t3a.medium (2c/4g) or larger
            // under the on-demand price of t3a.medium
            // in linux spot price order
            't3a.medium',
            't3.medium',
            't3a.large',
            'c6in.large',
            't3.large',
            'm6a.large',
            'r5a.large',
            'm5a.large',
            'm5.large',
            'r5.large',
          ],
          min: 0,
          max: 30,
        },
        {
          purpose: 'ingress',
          schedule: 'ondemand',
          instanceTypes: ['t4g.medium'],
          min: 0,
          max: 9, // three per subnet/AZ
        },
        {
          purpose: 'system',
          schedule: 'ondemand',
          instanceTypes: ['t4g.medium'],
          min: 3, // for consul minimum
          max: 10,
        },
      ];

for (const { groupName, purpose, instanceTypes, schedule, min, max, initial } of [
  ...standardGroups,
  ...(cfg.getObject<NodeGroup[]>('nodeGroups') ?? []),
]) {
  const arch = /^(a1|[^.]+g)[.]/.test(instanceTypes[0]) ? 'arm64' : 'amd64';
  const name = groupName ?? `${purpose}-${arch}-${schedule}`;

  new aws.eks.Nodegroup(
    name,
    {
      clusterName,
      nodeRole: nodeRole.arn,
      subnets: purpose === 'ingress' ? $network.natSubnetIds : $network.workloadSubnetIds,
      capacityType: schedule === 'ondemand' ? 'ON_DEMAND' : 'SPOT',
      amiType: arch === 'arm64' ? 'AL2_ARM_64' : 'AL2_x86_64',
      instanceTypes,
      diskSize: 100,
      scalingConfig: {
        minSize: min,
        desiredSize: initial ?? min,
        maxSize: max,
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
      updateConfig: max >= 5 ? { maxUnavailablePercentage: 20 } : { maxUnavailable: 1 },
      labels: {
        'bes.node.group': name,
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
        'k8s.io/cluster-autoscaler/node-template/resources/ephemeral-storage': '100G',

        ...(schedule === 'ondemand'
          ? {}
          : {
              // Used by the cluster-autoscaler to prefer spot instances
              'k8s.io/cluster-autoscaler/node-template/taint/spotInstance': 'true:PreferNoSchedule',
            }),

        // These labels can be used to target specific node groups for workloads
        // and will be understood by the auto-scaler for min=0 node groups.
        'k8s.io/cluster-autoscaler/node-template/label/bes.node.group': name,
        'k8s.io/cluster-autoscaler/node-template/label/bes.node.purpose': purpose,
        'k8s.io/cluster-autoscaler/node-template/label/bes.node.schedule': schedule,
        'k8s.io/cluster-autoscaler/node-template/label/bes.node.arch': arch,
      },
    },
    {
      replaceOnChanges: ['instanceTypes'],
      ignoreChanges: ['scalingConfig.desiredSize'],
      deleteBeforeReplace: false,
    },
  );
}

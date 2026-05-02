import * as aws from '@pulumi/aws-native';
import { $network, cfg } from '../../common/coreRef.ts';
import { nodeRole } from '../roles.ts';
import { clusterName, tags } from '../cluster.ts';
import { region } from '../../common/awsAccount.ts';
import { nativeTags } from '../../common/tags.ts';
import { upToMonthly, onlyBurst, instancesSizedAtLeast } from '../../common/k8s/instanceTypeGroups.ts';
import { Output } from '@pulumi/pulumi';

// Limit the number of AZs to use for node groups (default: use all available)
const azLimit = cfg.getNumber('azLimit');

// Whether to use custom launch templates with IPv6 IMDS support (default: true)
const withLaunchTemplate = cfg.getBoolean('withLaunchTemplate') ?? true;

// One-shot seed nodegroup for bootstrapping a fresh cluster onto Karpenter.
// Set to true on initial cluster creation, then back to false once Karpenter
// has migrated onto its own provisioned system node. See docs/kubernetes.md
// §3.1. Dormant in steady-state clusters — node provisioning is otherwise
// fully Karpenter-managed (see ../karpenter/).
const bootstrap = cfg.getBoolean('bootstrap') ?? false;

type NodeGroupPurpose = 'workload' | 'ingress' | 'system';
type NodeGroupSchedule = 'ondemand' | 'spot';
type NodeGroupArch = 'amd64' | 'arm64';

export interface NodeGroup {
  groupName: string;
  purpose: NodeGroupPurpose;
  schedule: NodeGroupSchedule;
  arch: NodeGroupArch;
  instanceTypes: string[] | Output<string[]>;
  minPerAz?: number;
  maxPerAz: number;
  initial?: number;
  amiType?: string;
  diskSize?: number;
}

const bootstrapGroups: NodeGroup[] = bootstrap
  ? [
      {
        groupName: 'bootstrap-system',
        purpose: 'system',
        schedule: 'ondemand',
        arch: 'arm64',
        diskSize: 25,
        instanceTypes: upToMonthly(
          onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
          'linux',
          'ondemand',
          100,
        ).map((i) => i.instance_type),
        minPerAz: 1,
        maxPerAz: 1,
      },
    ]
  : [];

for (const {
  groupName,
  purpose,
  instanceTypes,
  arch,
  schedule,
  minPerAz = 0,
  maxPerAz,
  initial,
  amiType = arch === 'arm64' ? 'BOTTLEROCKET_ARM_64' : 'BOTTLEROCKET_x86_64',
  diskSize = 100,
} of [...bootstrapGroups, ...(cfg.getObject<NodeGroup[]>('nodeGroups') ?? [])]) {
  // k[placement.ingress-subnets] k[placement.workload-subnets]
  const allSubnets = purpose === 'ingress' ? $network.natSubnetIds : $network.workloadSubnetIds;
  allSubnets.apply((subnets) => {
    const limitedSubnets = azLimit ? subnets.slice(0, azLimit) : subnets;
    limitedSubnets.forEach((subnet, az0) => {
      const az = az0 + 1;

      const launchTemplate = withLaunchTemplate
        ? new aws.ec2.LaunchTemplate(`${groupName}-az${az}-lt`, {
            launchTemplateName: `${groupName}-az${az}`,
            launchTemplateData: {
              // k[imds.v2-required] k[imds.ipv6]
              metadataOptions: {
                httpEndpoint: 'enabled',
                httpTokens: 'required',
                httpPutResponseHopLimit: 2,
                httpProtocolIpv6: 'enabled',
              },
              monitoring: { enabled: true },
              creditSpecification: schedule === 'ondemand' ? { cpuCredits: 'unlimited' } : undefined,
              // k[storage.system-ingress-disk-size] k[storage.encryption]
              blockDeviceMappings: [
                {
                  deviceName: '/dev/xvdb',
                  ebs: {
                    volumeSize: diskSize,
                    volumeType: 'gp3',
                    encrypted: true,
                    deleteOnTermination: true,
                  },
                },
              ],
              tagSpecifications: [
                { resourceType: 'instance', tags: nativeTags(tags) },
                { resourceType: 'volume', tags: nativeTags(tags) },
              ],
            },
          })
        : undefined;

      new aws.eks.Nodegroup(
        `${groupName}-az${az}`,
        {
          nodegroupName: withLaunchTemplate ? `${groupName}-az${az}` : undefined,
          clusterName,
          nodeRole: nodeRole.arn,
          subnets: [subnet],
          capacityType: schedule === 'ondemand' ? 'ON_DEMAND' : 'SPOT',
          amiType,
          instanceTypes,
          diskSize: withLaunchTemplate ? undefined : diskSize,
          launchTemplate: launchTemplate
            ? {
                id: launchTemplate.launchTemplateId,
                version: launchTemplate.latestVersionNumber.apply(
                  (v) => v?.toString() ?? '$Latest',
                ),
              }
            : undefined,
          // k[interruption.health-events]
          nodeRepairConfig: { enabled: true },
          scalingConfig: {
            minSize: minPerAz,
            desiredSize: initial ?? minPerAz,
            maxSize: maxPerAz,
          },
          // k[node.taint.spot]
          taints:
            schedule === 'ondemand'
              ? []
              : [{ key: 'spotInstance', value: 'true', effect: 'PREFER_NO_SCHEDULE' }],
          updateConfig: maxPerAz >= 5 ? { maxUnavailablePercentage: 20 } : { maxUnavailable: 1 },
          // k[node.label.purpose] k[node.label.schedule] k[node.label.arch] k[node.label.group]
          labels: {
            'bes.node.group': groupName,
            'bes.node.purpose': purpose,
            'bes.node.schedule': schedule,
            'bes.node.arch': arch,
          },
          tags: {
            ...tags,
            Purpose: `k8s-${purpose}`,
          },
        },
        {
          ignoreChanges: ['scalingConfig.desiredSize'],
          deleteBeforeReplace: false,
          replaceOnChanges: ['launchTemplate.id'],
        },
      );
    });
  });
}

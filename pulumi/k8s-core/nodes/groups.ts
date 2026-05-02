import * as aws from '@pulumi/aws-native';
import { $network, cfg } from '../../common/coreRef.ts';
import { nodeRole } from '../roles.ts';
import { clusterName, tags } from '../cluster.ts';
import { region } from '../../common/awsAccount.ts';
import { nativeTags } from '../../common/tags.ts';
import { upToMonthly, onlyBurst, instancesSizedAtLeast } from '../../common/k8s/instanceTypeGroups.ts';

// One-shot seed nodegroup for bootstrapping a fresh cluster onto Karpenter.
// Set bootstrap: true on initial cluster creation (alongside useKarpenter:
// true), then back to false once Karpenter has migrated onto its own
// provisioned system node. See docs/kubernetes.md §3.1.
//
// Steady-state clusters set bootstrap: false (or leave unset) and have zero
// managed nodegroups — node provisioning is fully Karpenter-managed (see
// ../karpenter/).
const bootstrap = cfg.getBoolean('bootstrap') ?? false;

if (bootstrap) {
  const azLimit = cfg.getNumber('azLimit');
  const withLaunchTemplate = cfg.getBoolean('withLaunchTemplate') ?? true;
  const groupName = 'bootstrap-system';
  const diskSize = 25;
  const instanceTypes = upToMonthly(
    onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
    'linux',
    'ondemand',
    100,
  ).map((i) => i.instance_type);

  // k[placement.workload-subnets]
  $network.workloadSubnetIds.apply((subnets) => {
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
              creditSpecification: { cpuCredits: 'unlimited' },
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
          capacityType: 'ON_DEMAND',
          amiType: 'BOTTLEROCKET_ARM_64',
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
          scalingConfig: { minSize: 1, desiredSize: 1, maxSize: 1 },
          updateConfig: { maxUnavailable: 1 },
          // k[node.label.purpose] k[node.label.schedule] k[node.label.arch] k[node.label.group]
          labels: {
            'bes.node.group': groupName,
            'bes.node.purpose': 'system',
            'bes.node.schedule': 'ondemand',
            'bes.node.arch': 'arm64',
          },
          tags: { ...tags, Purpose: 'k8s-system' },
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

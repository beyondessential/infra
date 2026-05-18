import { all, type Input, type Output, type Resource, output } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws-native';
import { $network, cfg } from '../../common/coreRef.ts';
import { nodeRole } from '../roles.ts';
import { clusterName, tags } from '../cluster.ts';
import { region } from '../../common/awsAccount.ts';
import { nativeTags } from '../../common/tags.ts';
import { upToMonthly, onlyBurst, instancesSizedAtLeast } from '../../common/k8s/instanceTypeGroups.ts';

// Seed nodegroups for bootstrapping a fresh cluster onto Karpenter. Set
// bootstrap: true on initial cluster creation (alongside useKarpenter: true),
// then back to false once Karpenter has migrated onto its own provisioned
// nodes. See docs/kubernetes.md §3.1.
//
// Two purposes are seeded:
//
// - system: where Karpenter itself, external-dns, and other cluster-wide
//   workloads run.
// - ingress: where LBC and cert-manager run. Without this, those would never
//   schedule during bootstrap (their required affinity is `purpose: ingress`,
//   which only Karpenter can otherwise produce — and Karpenter depends on
//   LBC, so we'd deadlock).
//
// Steady state: zero managed nodegroups — Karpenter handles everything.
const bootstrap = cfg.getBoolean('bootstrap') ?? false;

// Two AZs is the minimum that satisfies the `minDomains: 2` topology spread
// constraints on LBC, cert-manager, and external-dns. Bootstrap doesn't need
// more than the minimum — Karpenter takes over with the full AZ spread
// shortly after.
const BOOTSTRAP_AZS = 2;

// Resources that need a node available before they can be scheduled use this
// as `dependsOn`. Resolves to the bootstrap nodegroup set when bootstrap is
// on; resolves to an empty list in steady state (where Karpenter handles all
// node provisioning).
export const bootstrapNodegroups: Output<aws.eks.Nodegroup[]> = bootstrap
  ? createBootstrapNodegroups()
  : output<aws.eks.Nodegroup[]>([]);

// Combine the bootstrap nodegroups with caller-supplied dependencies into a
// single dependsOn-compatible value. Cleaner than threading
// `bootstrapNodegroups.apply((ngs) => [...others, ...ngs])` at every site.
export function withBootstrap(extra: Input<Resource>[] = []): Output<Input<Resource>[]> {
  return bootstrapNodegroups.apply((ngs) => [...extra, ...ngs]);
}

type BootstrapPurpose = 'system' | 'ingress';

function createBootstrapNodegroups(): Output<aws.eks.Nodegroup[]> {
  const azLimit = Math.min(cfg.getNumber('azLimit') ?? BOOTSTRAP_AZS, BOOTSTRAP_AZS);
  const withLaunchTemplate = cfg.getBoolean('withLaunchTemplate') ?? true;
  const instanceTypes = upToMonthly(
    onlyBurst(instancesSizedAtLeast(region, 'arm64', 2, 4)),
    'linux',
    'ondemand',
    100,
  ).map((i) => i.instance_type);

  // k[placement.workload-subnets] k[placement.ingress-subnets]
  return all([$network.workloadSubnetIds, $network.natSubnetIds]).apply(
    ([workloadSubnets, natSubnets]) => [
      ...makeBootstrapNodegroups('system', workloadSubnets.slice(0, azLimit), {
        instanceTypes,
        withLaunchTemplate,
      }),
      ...makeBootstrapNodegroups('ingress', natSubnets.slice(0, azLimit), {
        instanceTypes,
        withLaunchTemplate,
      }),
    ],
  );
}

interface NodegroupOpts {
  instanceTypes: string[];
  withLaunchTemplate: boolean;
}

function makeBootstrapNodegroups(
  purpose: BootstrapPurpose,
  subnets: string[],
  opts: NodegroupOpts,
): aws.eks.Nodegroup[] {
  const groupName = `bootstrap-${purpose}`;
  const diskSize = 25;

  return subnets.map((subnet, az0) => {
    const az = az0 + 1;

    const launchTemplate = opts.withLaunchTemplate
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

    return new aws.eks.Nodegroup(
      `${groupName}-az${az}`,
      {
        nodegroupName: opts.withLaunchTemplate ? `${groupName}-az${az}` : undefined,
        clusterName,
        nodeRole: nodeRole.arn,
        subnets: [subnet],
        capacityType: 'ON_DEMAND',
        amiType: 'BOTTLEROCKET_ARM_64',
        instanceTypes: opts.instanceTypes,
        diskSize: opts.withLaunchTemplate ? undefined : diskSize,
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
          'bes.node.purpose': purpose,
          'bes.node.schedule': 'ondemand',
          'bes.node.arch': 'arm64',
        },
        tags: { ...tags, Purpose: `k8s-${purpose}` },
      },
      {
        ignoreChanges: ['scalingConfig.desiredSize'],
        deleteBeforeReplace: false,
        replaceOnChanges: ['launchTemplate.id'],
      },
    );
  });
}

import { all, type Input, type Output, type Resource } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws-native';
import { $network, cfg } from '../../common/coreRef.ts';
import { nodeRole } from '../roles.ts';
import { clusterName, tags } from '../cluster.ts';
import { region } from '../../common/awsAccount.ts';
import { nativeTags } from '../../common/tags.ts';
import { upToMonthly, onlyBurst, instancesSizedAtLeast } from '../../common/k8s/instanceTypeGroups.ts';

// Standby nodegroups for bootstrap *and* recovery. Two purposes are seeded:
//
// - system: where Karpenter itself, external-dns, and other cluster-wide
//   workloads run.
// - ingress: where LBC and cert-manager run. Without this, those would never
//   schedule during bootstrap (their required affinity is `purpose: ingress`,
//   which only Karpenter can otherwise produce — and Karpenter depends on
//   LBC, so we'd deadlock).
//
// The nodegroups exist in every state. The `bootstrap` config flag only
// controls the *initial* desiredSize: true → 1 (seed nodes for a fresh
// cluster), false → 0 (parked). Once the resource is created, desiredSize
// is in `ignoreChanges` so manual scaling sticks — meaning operators can
// recover a wedged cluster (e.g. Karpenter drops every ingress node, taking
// Tailscale and the API down with it) by bumping the relevant bootstrap
// nodegroup's desired in the AWS console.
//
// See docs/sops/bootstrap-k8s-cluster.md and docs/sops/scale-bootstrap-nodegroups.md.
const bootstrap = cfg.getBoolean('bootstrap') ?? false;

// Two AZs is the minimum that satisfies the `minDomains: 2` topology spread
// constraints on LBC, cert-manager, and external-dns. Bootstrap doesn't need
// more than the minimum — Karpenter takes over with the full AZ spread
// shortly after.
const BOOTSTRAP_AZS = 2;

// Resources that need a node available before they can be scheduled use this
// as `dependsOn`. Always populated now; the standby nodegroups are present in
// steady state too. With them parked at desired=0 the dependency is satisfied
// at resource-creation time without forcing any actual nodes to exist.
export const bootstrapNodegroups: Output<aws.eks.Nodegroup[]> =
  createBootstrapNodegroups();

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

  // spec: K8SNOD#placement
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
            // spec: K8SNOD#instance-metadata
            metadataOptions: {
              httpEndpoint: 'enabled',
              httpTokens: 'required',
              httpPutResponseHopLimit: 2,
              httpProtocolIpv6: 'enabled',
            },
            monitoring: { enabled: true },
            creditSpecification: { cpuCredits: 'unlimited' },
            // spec: K8SNOD#node-storage
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
        // spec: K8SNOD#interruption-and-consolidation
        nodeRepairConfig: { enabled: true },
        // Initial desired comes from the bootstrap flag; `ignoreChanges` below
        // protects manual scaling (both bootstrap-completion and incident
        // recovery) from being clobbered by later `pulumi up` runs.
        scalingConfig: { minSize: 0, desiredSize: bootstrap ? 1 : 0, maxSize: 1 },
        updateConfig: { maxUnavailable: 1 },
        // spec: K8SNOD#node-identity
        // Karpenter's controller has a DoNotSchedule topology spread on
        // `karpenter.sh/capacity-type` — without the label here, the
        // controller pods can't schedule on bootstrap nodes and the whole
        // cluster wedges before Karpenter ever starts. Karpenter writes this
        // label itself on the nodes it provisions; we have to set it
        // explicitly on managed nodegroup nodes.
        labels: {
          'bes.node.group': groupName,
          'bes.node.purpose': purpose,
          'bes.node.schedule': 'ondemand',
          'bes.node.arch': 'arm64',
          'karpenter.sh/capacity-type': 'on-demand',
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

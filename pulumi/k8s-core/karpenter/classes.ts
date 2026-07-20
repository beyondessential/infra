import * as k8s from '@pulumi/kubernetes';
import { $network, cfg, stackName } from '../../common/coreRef.ts';
import { provider } from '../kubeconfig.ts';
import { cluster, tags } from '../cluster.ts';
import { nodeRole } from '../roles.ts';
import { karpenter } from './controller.ts';

// Subnet and security group selection runs off resource IDs from the IaC
// graph (network cross-stack, EKS cluster object). Tag-based discovery is
// fragile — when a tag goes missing or drifts, every NodeClass flips
// SubnetsNotFound and Karpenter stops provisioning. IDs can't drift.
const workloadSubnetTerms = $network.workloadSubnetIds.apply((ids) =>
  ids.map((id) => ({ id })),
);
const natSubnetTerms = $network.natSubnetIds.apply((ids) =>
  ids.map((id) => ({ id })),
);
const clusterSgTerm = [{ id: cluster.clusterSecurityGroupId }];

// EC2NodeClass `role` takes the role name, not ARN.
const nodeRoleName = nodeRole.name;

// Prefix for EC2 instance Name tags. Distinguishes Karpenter-provisioned
// nodes from other EC2 instances in the AWS console. No brackets/parens/etc:
// these tags get propagated to the InstanceProfile Karpenter creates, and
// IAM tag values only accept [\p{L}\p{Z}\p{N}_.:/=+\-@].
const namePrefix = `Kubernetes ${stackName}`;

// Karpenter rejects EC2NodeClass.spec.tags entries with restricted keys
// (kubernetes.io/cluster/*, karpenter.sh/*, karpenter.k8s.aws/ec2nodeclass).
// Strip them out of the inherited tag set.
const restrictedTagPrefixes = ['kubernetes.io/cluster/', 'karpenter.sh/', 'karpenter.k8s.aws/'];
const inheritedTags = Object.fromEntries(
  Object.entries(tags).filter(([k]) => !restrictedTagPrefixes.some((p) => k.startsWith(p))),
);

// k[imds.v2-required] k[imds.ipv6]
const commonMetadataOptions = {
  httpEndpoint: 'enabled',
  httpProtocolIPv6: 'enabled',
  httpPutResponseHopLimit: 2,
  httpTokens: 'required',
};

// k[storage.encryption]
function ebs(volumeSize: string) {
  return [
    {
      deviceName: '/dev/xvdb',
      ebs: {
        volumeSize,
        volumeType: 'gp3',
        encrypted: true,
      },
    },
  ];
}

// k[storage.workload-disk-size]
// Size against measured steady-state node fs usage with ~2x headroom; the
// kubelet image GC high threshold (85%) is the ceiling to stay clear of.
const workloadDiskGi = cfg.getNumber('workloadDiskGi') ?? 60;

// k[placement.workload-subnets] k[storage.workload-disk-size]
export const workloadNodeClass = new k8s.apiextensions.CustomResource(
  'nodeclass-workload',
  {
    apiVersion: 'karpenter.k8s.aws/v1',
    kind: 'EC2NodeClass',
    metadata: { name: 'workload' },
    spec: {
      role: nodeRoleName,
      amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
      subnetSelectorTerms: workloadSubnetTerms,
      securityGroupSelectorTerms: clusterSgTerm,
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs(`${workloadDiskGi}Gi`),
      tags: {
        'bes.node.purpose': 'workload',
        Name: `${namePrefix} workload`,
        Purpose: 'k8s-workload',
        ...inheritedTags,
      },
    },
  },
  { provider, dependsOn: [karpenter] },
);

// k[placement.ingress-subnets] k[storage.system-ingress-disk-size]
export const ingressNodeClass = new k8s.apiextensions.CustomResource(
  'nodeclass-ingress',
  {
    apiVersion: 'karpenter.k8s.aws/v1',
    kind: 'EC2NodeClass',
    metadata: { name: 'ingress' },
    spec: {
      role: nodeRoleName,
      amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
      subnetSelectorTerms: natSubnetTerms,
      securityGroupSelectorTerms: clusterSgTerm,
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs('15Gi'),
      tags: {
        'bes.node.purpose': 'ingress',
        Name: `${namePrefix} ingress`,
        Purpose: 'k8s-ingress',
        ...inheritedTags,
      },
    },
  },
  { provider, dependsOn: [karpenter] },
);

// k[placement.workload-subnets] k[storage.system-ingress-disk-size]
export const systemNodeClass = new k8s.apiextensions.CustomResource(
  'nodeclass-system',
  {
    apiVersion: 'karpenter.k8s.aws/v1',
    kind: 'EC2NodeClass',
    metadata: { name: 'system' },
    spec: {
      role: nodeRoleName,
      amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
      subnetSelectorTerms: workloadSubnetTerms,
      securityGroupSelectorTerms: clusterSgTerm,
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs('15Gi'),
      tags: {
        'bes.node.purpose': 'system',
        Name: `${namePrefix} system`,
        Purpose: 'k8s-system',
        ...inheritedTags,
      },
    },
  },
  { provider, dependsOn: [karpenter] },
);

// k[placement.exit-node-subnets] k[capacity.exit-node-dedicated]
// Dedicated class for the Tailscale exit node so it runs isolated on its own
// tainted node: it is a live network path, and sharing a node would let
// workload compute contention degrade routing for connected clients.
// Workload (private) subnet so its forwarded client traffic egresses through
// the per-AZ NAT gateways, giving a stable, known set of egress IPs (the NAT
// Elastic IPs, one per AZ, plus the VPC IPv6 /56) that partners can allowlist,
// rather than the ephemeral per-instance public IP that direct IGW egress
// yields. A distinctive `bes.node.purpose` tag lets GuardDuty findings for its
// egress (the operator's DoH to public resolvers lands on this node) be
// attributed and suppressed by instance tag rather than blinding DoH detection
// cluster-wide. Few pods ever schedule here (the exit node plus the daemonsets
// that tolerate its taint), so cap max-pods low to reclaim the kubelet memory
// reservation on a small burstable node.
export const exitNodeClass = new k8s.apiextensions.CustomResource(
  'nodeclass-tailscale-exit',
  {
    apiVersion: 'karpenter.k8s.aws/v1',
    kind: 'EC2NodeClass',
    metadata: { name: 'tailscale-exit' },
    spec: {
      role: nodeRoleName,
      amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
      subnetSelectorTerms: workloadSubnetTerms,
      securityGroupSelectorTerms: clusterSgTerm,
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs('15Gi'),
      kubelet: { maxPods: 15 },
      tags: {
        'bes.node.purpose': 'tailscale-exit',
        Name: `${namePrefix} tailscale-exit`,
        Purpose: 'k8s-tailscale-exit',
        ...inheritedTags,
      },
    },
  },
  { provider, dependsOn: [karpenter] },
);

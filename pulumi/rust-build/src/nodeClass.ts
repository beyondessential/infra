import * as k8s from '@pulumi/kubernetes';
import { $core, $network, tags as coreTags } from '../../common/k8s/coreRef.ts';
import { buildDiskGi } from './config.ts';

// This stack owns its own EC2NodeClass (rather than reusing k8s-core's
// `workload` class) so it controls the node root-disk size. It consumes three
// inputs from k8s-core: workload subnet IDs (via $network), the node IAM role
// name, and the cluster security group (the latter two exported from
// k8s-core/index.ts). No AWS credentials are needed to create the CR — the
// values are plain strings that Karpenter resolves at runtime.

// Karpenter rejects EC2NodeClass.spec.tags with restricted keys; strip them out
// of the inherited core tag set (mirrors k8s-core/karpenter/classes.ts).
const restrictedTagPrefixes = ['kubernetes.io/cluster/', 'karpenter.sh/', 'karpenter.k8s.aws/'];
const inheritedTags = coreTags.apply((t) =>
  Object.fromEntries(
    Object.entries(t).filter(([k]) => !restrictedTagPrefixes.some((p) => k.startsWith(p))),
  ),
);

const workloadSubnetTerms = $network
  .apply((n) => n.workloadSubnetIds)
  .apply((ids) => ids.map((id) => ({ id })));

export const buildNodeClass = new k8s.apiextensions.CustomResource('nodeclass-build', {
  apiVersion: 'karpenter.k8s.aws/v1',
  kind: 'EC2NodeClass',
  metadata: { name: 'build' },
  spec: {
    role: $core.nodeRoleName,
    amiSelectorTerms: [{ alias: 'bottlerocket@latest' }],
    subnetSelectorTerms: workloadSubnetTerms,
    securityGroupSelectorTerms: [{ id: $core.clusterSecurityGroupId }],
    metadataOptions: {
      httpEndpoint: 'enabled',
      httpProtocolIPv6: 'enabled',
      httpPutResponseHopLimit: 2,
      httpTokens: 'required',
    },
    // Bottlerocket data volume: container image + apt layers + /tmp. Persistent
    // build caches live on the pod's EBS PVC, not here.
    blockDeviceMappings: [
      {
        deviceName: '/dev/xvdb',
        ebs: { volumeSize: `${buildDiskGi}Gi`, volumeType: 'gp3', encrypted: true },
      },
    ],
    tags: inheritedTags.apply((t) => ({
      'bes.node.purpose': 'build',
      Name: 'Kubernetes build',
      Purpose: 'k8s-build',
      ...t,
    })),
  },
});

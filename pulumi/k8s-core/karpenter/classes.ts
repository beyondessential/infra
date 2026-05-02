import * as k8s from '@pulumi/kubernetes';
import { provider } from '../kubeconfig.ts';
import { clusterName, tags } from '../cluster.ts';
import { nodeRole } from '../roles.ts';
import { karpenter } from './controller.ts';

// EC2NodeClass `role` takes the role name, not ARN.
const nodeRoleName = nodeRole.name;

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
      subnetSelectorTerms: [
        {
          tags: {
            'karpenter.sh/discovery': clusterName,
            Purpose: 'workload',
          },
        },
      ],
      securityGroupSelectorTerms: [{ tags: { 'karpenter.sh/discovery': clusterName } }],
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs('60Gi'),
      tags: {
        'bes.node.purpose': 'workload',
        Purpose: 'k8s-workload',
        ...tags,
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
      subnetSelectorTerms: [
        {
          tags: {
            'karpenter.sh/discovery': clusterName,
            Purpose: 'nat',
          },
        },
      ],
      securityGroupSelectorTerms: [{ tags: { 'karpenter.sh/discovery': clusterName } }],
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs('15Gi'),
      tags: {
        'bes.node.purpose': 'ingress',
        Purpose: 'k8s-ingress',
        ...tags,
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
      subnetSelectorTerms: [
        {
          tags: {
            'karpenter.sh/discovery': clusterName,
            Purpose: 'workload',
          },
        },
      ],
      securityGroupSelectorTerms: [{ tags: { 'karpenter.sh/discovery': clusterName } }],
      metadataOptions: commonMetadataOptions,
      blockDeviceMappings: ebs('15Gi'),
      tags: {
        'bes.node.purpose': 'system',
        Purpose: 'k8s-system',
        ...tags,
      },
    },
  },
  { provider, dependsOn: [karpenter] },
);

import { Agent } from 'node:https';
import { interpolate } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws-native';
import * as awsClassic from '@pulumi/aws';
import { getIssuerCAThumbprint } from '@pulumi/eks/cert-thumprint.js';
import { AWS_STS } from '../constants/external.js';
import { $network, cfg, stackName } from '../common/coreRef.js';
import { dnsSuffix, region } from '../common/awsAccount.js';
import { nativeTags } from '../common/tags.js';
import { controlPlaneRole } from './roles.js';

export const version = cfg.require('version');
if (parseInt(version.split('.')?.[1]) < 21) {
  // 1.20 and below don't support IPv6 in AWS
  throw new Error('EKS version must be >= 1.21');
}

export const tags = {
  Cluster: `k8s-${stackName}`,
  [`kubernetes.io/cluster/${stackName}`]: 'owned',
};

export const cluster = new aws.eks.Cluster(
  'cluster',
  {
    name: stackName,
    resourcesVpcConfig: {
      subnetIds: $network.subnetIds,
      endpointPrivateAccess: true,
      endpointPublicAccess: true,
    },
    roleArn: controlPlaneRole.arn,
    kubernetesNetworkConfig: {
      // This is just in case we really want to make an IPv4-only cluster, but in
      // general we should be using IPv6 dualstack everywhere.
      ipFamily: $network.v6Cidr.apply((v6) => (v6 ? 'ipv6' : 'ipv4')),
    },
    version,
    tags: nativeTags(tags, {
      Purpose: 'k8s-system',
    }),
  },
  {
    // changing this Cluster in any way causes pulumi to throw a tantrum,
    // so protect it and ignore certain bits forcefully
    ignoreChanges: ['tags'],
  },
);

export const clusterName = cluster.name.apply((n) => n!);

// OIDC provider for the cluster
const https = new Agent({ maxCachedSessions: 0 });
const eksOidcProviderUrl = interpolate`https://oidc.eks.${region}.${dnsSuffix}`;
const fingerprint = getIssuerCAThumbprint(eksOidcProviderUrl, https);
export const oidcProvider = new aws.iam.OidcProvider('eks-oidc', {
  clientIdList: [AWS_STS],
  thumbprintList: [fingerprint],
  url: cluster.openIdConnectIssuerUrl,
});

new aws.eks.IdentityProviderConfig(
  'oidc',
  {
    clusterName,
    type: aws.eks.IdentityProviderConfigType.Oidc,
    oidc: {
      clientId: oidcProvider.clientIdList[0],
      issuerUrl: cluster.openIdConnectIssuerUrl,
    },
  },
  { parent: cluster },
);

export function addAddon(
  addonName: string,
  {
    purpose,
    ...args
  }: Omit<aws.eks.AddonArgs, 'clusterName' | 'addonName' | 'addonVersion'> & { purpose: string },
): aws.eks.Addon {
  const { version: addonVersion } = awsClassic.eks.getAddonVersionOutput({
    addonName,
    kubernetesVersion: cluster.version.apply((n) => n!),
    mostRecent: true,
  });

  return new aws.eks.Addon(
    addonName,
    {
      clusterName,
      addonName,
      addonVersion,
      ...args,
      tags: nativeTags(tags, {
        Purpose: `k8s-${purpose}`,
      }),
    },
    {
      // /!\ inherits cluster's protect
      parent: cluster,
      // otherwise on replace, pulumi tries to delete the addon it just created like a dumbass
      deleteBeforeReplace: true,
      // for stability, don't update addon by default (comment if wanted)
      ignoreChanges: ['addonVersion'],
    },
  );
}

// These three are required for a functional cluster
addAddon('vpc-cni', { purpose: 'networking', resolveConflicts: 'OVERWRITE' });
addAddon('kube-proxy', { purpose: 'networking', resolveConflicts: 'OVERWRITE' });
addAddon('coredns', { purpose: 'networking', resolveConflicts: 'OVERWRITE' });

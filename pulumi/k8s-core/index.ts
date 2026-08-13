export { coreStackName, region } from '../common/coreRef.ts';
import { cfg, failIfIncorrectAccount } from '../common/coreRef.ts';
failIfIncorrectAccount();

import { cluster, oidcProvider } from './cluster.ts';
export { clusterName as name, tags, version } from './cluster.ts';
import { nodeRole } from './roles.ts';
import { bucket as backupsBucketObj, role as backupsRole } from './backups.ts';
import {
  role as opencostRole,
  spotDataFeedBucketName,
  opencostExportBucketName,
} from './opencost.ts';
export const arn = cluster.arn;
export const endpoint = cluster.endpoint;
export const ca = cluster.certificateAuthorityData;
export const backupsBucket = backupsBucketObj.bucket;
export const backupsServiceAccountArn = backupsRole.arn;
export const oidcProviderArn = oidcProvider.arn;
export const opencostRoleArn = opencostRole.arn;
export { spotDataFeedBucketName, opencostExportBucketName };

// Consumed by the out-of-tree `rust-build` stack (pulumi/rust-build/) to build
// its own EC2NodeClass for dedicated Rust-build nodes: the node IAM role name
// and the EKS cluster security group. Workload subnet IDs come via $network, so
// only these two need exporting. See docs/plans/rust-remote-build.md.
export const nodeRoleName = nodeRole.name;
export const clusterSecurityGroupId = cluster.clusterSecurityGroupId;

// Single source of truth for "is Envoy Gateway part of this cluster's stack?"
// k8s-essentials reads this back to gate envoyGateway.ts; k8s-core uses it
// to gate cert-manager's Gateway API integration.
export const envoyGatewayEnabled = cfg.getBoolean('envoyGatewayEnabled') ?? false;

// DNS zones managed by this cluster — consumed by on-k8s to derive the default ingress domain.
export const externalDnsZoneDomains: string[] = Object.keys(
  (cfg.getObject<Record<string, string>>('externalDnsZones')) ?? {},
);

// Per-cluster Tailscale proxy tags the operator's OAuth client is authorised to
// mint on proxy devices. k8s-essentials applies these as the operator's
// proxyConfig defaultTags; on-k8s reads them back to tag DB LoadBalancer proxies
// with the cluster-appropriate proxy tag rather than hardcoding one.
export const tailscaleProxyDefaultTags: string[] = cfg.getObject('tailscaleProxyDefaultTags') ?? [
  'tag:k8s',
  'tag:k8s-proxy',
];

import './awsBackup.ts';
import './nodes/groups.ts';
import './nodes/monitor.ts';

import './storage/ebs.ts';
import './storage/s3.ts';

if (cfg.getBoolean('enableEfsStorage') ?? false) {
  await import('./storage/efs.ts');
}

if (cfg.getBoolean('enableAwsLb') ?? true) {
  await import('./loadbalancer/ingress.ts');
}

if (cfg.getBoolean('enableCertManager') ?? true) {
  await import('./cert-manager/controller.ts');

  if (cfg.getBoolean('enableCertManagerPublic') ?? true) {
    await import('./cert-manager/letsencrypt.ts');
    await import('./cert-manager/zerossl.ts');
  }
}

if (cfg.getBoolean('enableExternalDns') ?? true) {
  await import('./externalDns.ts');
}

if (cfg.getBoolean('useKarpenter') ?? false) {
  await import('./karpenter/controller.ts');
  await import('./karpenter/classes.ts');
  await import('./karpenter/pools.ts');
  await import('./karpenter/placeholders.ts');
}

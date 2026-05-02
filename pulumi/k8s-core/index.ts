export { coreStackName, region } from '../common/coreRef.ts';
import { cfg, failIfIncorrectAccount } from '../common/coreRef.ts';
failIfIncorrectAccount();

import { cluster, oidcProvider } from './cluster.ts';
export { clusterName as name, tags, version } from './cluster.ts';
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

import './awsBackup.ts';
import './nodes/groups.ts';
import './nodes/autoscaler.ts';
import './nodes/monitor.ts';

import './storage/ebs.ts';
import './storage/s3.ts';

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
  await import('./karpenter/discovery.ts');
}

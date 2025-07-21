export { coreStackName } from '../common/coreRef.ts';
import { failIfIncorrectAccount } from '../common/coreRef.ts';
failIfIncorrectAccount();

import { cluster, oidcProvider } from './cluster.ts';
export { clusterName as name, tags, version } from './cluster.ts';
import { bucket as backupsBucketObj, role as backupsRole } from './backups.ts';
export const arn = cluster.arn;
export const endpoint = cluster.endpoint;
export const ca = cluster.certificateAuthorityData;
export const backupsBucket = backupsBucketObj.bucket;
export const backupsServiceAccountArn = backupsRole.arn;
export const oidcProviderArn = oidcProvider.arn;

import './nodes/groups.ts';
import './nodes/autoscaler.ts';
import './nodes/monitor.ts';
import './loadbalancer/ingress.ts';
import './externalDns.ts';
import './cert-manager/controller.ts';
import './cert-manager/letsencrypt.ts';
import './cert-manager/zerossl.ts';
import './storage.ts';

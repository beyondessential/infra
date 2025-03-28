export { coreStackName } from '../common/coreRef.js';
import { failIfIncorrectAccount } from '../common/coreRef.js';
failIfIncorrectAccount();

import { cluster, oidcProvider } from './cluster.js';
export { clusterName as name, tags, version } from './cluster.js';
import { bucket as backupsBucketObj, role as backupsRole } from './backups.js';
export const arn = cluster.arn;
export const endpoint = cluster.endpoint;
export const ca = cluster.certificateAuthorityData;
export const backupsBucket = backupsBucketObj.bucket;
export const backupsServiceAccountArn = backupsRole.arn;
export const oidcProviderArn = oidcProvider.arn;

import './nodes/groups.js';
import './nodes/autoscaler.js';
import './nodes/monitor.js';
import './loadbalancer/ingress.js';
import './externalDns.js';
import './cert-manager/controller.js';
import './cert-manager/letsencrypt.js';
import './cert-manager/zerossl.js';
import './storage.js';

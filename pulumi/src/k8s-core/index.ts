export { coreStackName, failIfIncorrectAccount } from '../common/coreRef.js';
await failIfIncorrectAccount();

import { cluster } from './cluster.js';
export { clusterName as name, tags, version } from './cluster.js';
export const arn = cluster.arn;
export const endpoint = cluster.endpoint;
export const ca = cluster.certificateAuthorityData;

import './nodes/groups.js';
import './nodes/autoscaler.js';
import './loadbalancer/ingress.js';
import './externalDns.js';
import './cert-manager/controller.js';
import './cert-manager/letsencrypt.js';
import './cert-manager/zerossl.js';
import './storage.js';import { failIfIncorrectAccount } from '../common/coreRef.js';


import { failIfIncorrectAccount } from '../../common/coreRef.js';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
await failIfIncorrectCluster();
failIfIncorrectAccount();

import { ghaDagsterRole } from './github.js';
import './celery.js';

export const ghaDagsterRoleArn = ghaDagsterRole.arn;

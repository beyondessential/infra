import { failIfIncorrectAccount } from '../../common/coreRef.ts';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();
failIfIncorrectAccount();

import { ghaDagsterRole } from './github.ts';
import './celery.ts';

export const ghaDagsterRoleArn = ghaDagsterRole.arn;

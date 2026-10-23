import { failIfIncorrectAccountOrRegion } from '../../../common/coreRef.ts';
import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();
await failIfIncorrectAccountOrRegion();

import { ghaDagsterRole } from './github.ts';
export const ghaDagsterRoleArn = ghaDagsterRole.arn;

import { system } from './namespace.ts';
import { CeleryQueue } from './celery.ts';

// new CeleryQueue('dagster', { namespace: system });

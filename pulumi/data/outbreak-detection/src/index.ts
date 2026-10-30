import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import { namespace } from './namespace.ts';
import { sa } from './serviceAccount.ts';
import { s3bucket } from './config.ts';
import { pullSecret, pullSecretName } from './imagePullSecret.ts';

export const outputNamespace = namespace;
export const serviceAccount = sa.metadata.name;
export const bucket = s3bucket;
export const imagePullSecret = pullSecret ? pullSecretName : undefined;

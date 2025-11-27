import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './namespace.ts';
import './secrets.ts';
import './deployment.ts';
import './github.ts';

export { namespace } from './namespace.ts';
export { roleArn, clusterNameOutput, namespaceOutput, regionOutput } from './github.ts';

import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './namespace.ts';
import './secrets.ts';
import './deployment.ts';

export { namespace } from './namespace.ts';

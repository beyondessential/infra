import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './namespace.ts';
import './db.ts';
import './secrets.ts';
import './migrator.ts';
import './deployment.ts';
import './ingress.ts';

export { namespace } from './namespace.ts';
export { domain } from './config.ts';

import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './namespace.ts';
import './serviceAccount.ts';
import './secrets.ts';
import './helm.ts';
import './ingress.ts';
import './rbac.ts';

export { namespace } from './namespace.ts';

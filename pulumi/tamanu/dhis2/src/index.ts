import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './db.ts';
import './servers.ts';

export { domains } from './config.ts';

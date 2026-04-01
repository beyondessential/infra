import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './db.ts';
import './ca.ts';
import './jobs.ts';
import './servers.ts';

export { domains } from './config.ts';

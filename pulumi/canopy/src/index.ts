import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './db.ts';
import './ca.ts';
import './jobs.ts';
import './servers.ts';
import './gha-canopy.ts';

// spec: K8SCNP#outputs
export { domains } from './config.ts';

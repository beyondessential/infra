import { failIfIncorrectCluster } from '../common/k8s/coreRef.js';
await failIfIncorrectCluster();

import './mailgun.js';

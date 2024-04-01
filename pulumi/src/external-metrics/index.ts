import { failIfIncorrectCluster, cfg } from '../common/k8s/coreRef.js';
await failIfIncorrectCluster();

import './mailgun.js';
import './uptimerobot.js';

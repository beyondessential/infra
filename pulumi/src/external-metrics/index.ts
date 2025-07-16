import { failIfIncorrectCluster, cfg } from '../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './mailgun.ts';
import './uptimerobot.ts';

export { monitoringEmail } from './config.ts';
export { eventBusArn, eventBusName, snsTopicArn, workloadAlertsCentralArn } from './central.ts';
import './orgWide.ts';
import './perAccount.ts';

import { slackEnabled } from './config.ts';
if (slackEnabled) {
  await import('./slackNotifier.ts');
}

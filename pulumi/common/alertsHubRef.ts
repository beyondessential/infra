import { Output, StackReference } from '@pulumi/pulumi';

const ALERTS_HUB_STACK = 'bes/backup-monitoring/main';

const ref = new StackReference(ALERTS_HUB_STACK);

export const workloadAlertsCentralArn = ref.getOutput('workloadAlertsCentralArn') as Output<string>;

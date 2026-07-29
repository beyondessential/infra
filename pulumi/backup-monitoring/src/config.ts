import { Config } from '@pulumi/pulumi';

const config = new Config();

export const monitoringEmail = config.get('monitoringEmail') ?? 'felix@bes.au';

export const euCentral2Accounts = config.getObject<string[]>('euCentral2Accounts') ?? [];

// Slack workflow trigger URL for the ops channel. The URL is the credential, so it is
// held as a secret. Delivery to Slack is skipped entirely while this is unset, which
// keeps the rest of the stack deployable.
export const slackWebhookUrl = config.getSecret('slackWebhookUrl');
export const slackEnabled = config.get('slackWebhookUrl') !== undefined;

export const tags = {
  Purpose: 'backup-monitoring',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};

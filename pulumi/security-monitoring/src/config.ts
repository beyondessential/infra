import { Config } from '@pulumi/pulumi';

const config = new Config();

export const findingRegions = config.getObject<string[]>('findingRegions') ?? [
  'ap-southeast-2',
  'eu-central-2',
  'ap-south-1',
];

// Regions where GuardDuty was enabled before this stack existed, mapped to their
// detector ID. Those regions' resources are adopted rather than created. Drop entries
// once they are in state.
export const existingDetectorIds =
  config.getObject<Record<string, string>>('existingDetectorIds') ?? {};

// Governs how quickly updates to an *existing* finding are republished; new findings
// always reach EventBridge within about five minutes. Adopting a region requires this
// to match what that region already has, hence the conservative default.
export const findingPublishingFrequency = config.get('findingPublishingFrequency') ?? 'SIX_HOURS';

// GuardDuty severities: low 1-3.9, medium 4-6.9, high 7-8.9, critical 9-10.
export const severityThreshold = config.getNumber('severityThreshold') ?? 7;

// Slack workflow trigger URL for the security channel. The URL is the credential, so
// it is held as a secret.
export const slackWebhookUrl = config.requireSecret('slackWebhookUrl');

// Where to report that the Slack delivery path itself is dropping events. Deliberately
// email rather than Slack: it must not depend on what it is reporting on.
export const deliveryFailureEmail = config.get('deliveryFailureEmail') ?? 'felix@bes.au';

export const tags = {
  Purpose: 'security-monitoring',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};

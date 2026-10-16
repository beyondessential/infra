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

// Regions listed here cover only the named member accounts; every other region covers
// the whole organisation and picks up new accounts automatically. Restricting a region
// avoids paying to process replicated global CloudTrail events across all 36 accounts
// in a region only a couple of them use — but it also means a new account operating
// there is uncovered until it is added below. The defaults are the accounts with actual
// spend in each region.
export const regionAccounts = config.getObject<Record<string, string[]>>('regionAccounts') ?? {
  'eu-central-2': [
    '143295493206', // _Internal Tamanu
    '376129861948', // Zurich Tamanu Clone
    '658427548944', // Shared AMIs
  ],
  'ap-south-1': [
    '143295493206', // _Internal Tamanu
    '231969064999', // Pakistan Tamanu Clone
    '658427548944', // Shared AMIs
  ],
};

// Governs how quickly updates to an *existing* finding are republished; new findings
// always reach EventBridge within about five minutes regardless.
export const findingPublishingFrequency =
  config.get('findingPublishingFrequency') ?? 'FIFTEEN_MINUTES';

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

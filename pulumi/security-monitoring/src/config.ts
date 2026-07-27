import { Config } from '@pulumi/pulumi';

const config = new Config();

export const findingRegions = config.getObject<string[]>('findingRegions') ?? [
  'ap-southeast-2',
  'eu-central-2',
  'ap-south-1',
];

// The Chatbot API only answers in a handful of regions, none of which we run
// workloads in: chatbot.{ap-southeast-2,eu-central-2,ap-south-1,us-east-1} do not
// resolve at all. Its resources need a provider pinned here.
export const chatbotRegion = 'us-east-2';

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

export const slackTeamId = config.get('slackTeamId');
export const slackChannelId = config.get('slackChannelId');

export const tags = {
  Purpose: 'security-monitoring',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};

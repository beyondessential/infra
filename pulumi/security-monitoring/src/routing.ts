import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { findingRegions, severityThreshold, tags } from './config.ts';
import { regionProviders } from './providers.ts';

// A GuardDuty delegated administrator receives member-account findings on its own
// default event bus in each region, so one rule per region covers the organisation.
export const findingTopicArns = findingRegions.map((region) => {
  const provider = regionProviders[region];

  const topic = new aws.sns.Topic(
    `guardduty-findings-${region}`,
    {
      name: 'guardduty-findings',
      displayName: 'GuardDuty Findings',
      tags,
    },
    { provider },
  );

  new aws.sns.TopicPolicy(
    `guardduty-findings-policy-${region}`,
    {
      arn: topic.arn,
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowEventBridgePublish',
            Effect: 'Allow',
            Principal: {
              Service: 'events.amazonaws.com',
            },
            Action: 'SNS:Publish',
            Resource: topic.arn,
          },
        ],
      }),
    },
    { provider },
  );

  const rule = new aws.cloudwatch.EventRule(
    `guardduty-findings-${region}`,
    {
      name: 'guardduty-severe-findings',
      description: `Forward GuardDuty findings at severity ${severityThreshold} and above to SNS`,
      eventPattern: jsonStringify({
        source: ['aws.guardduty'],
        'detail-type': ['GuardDuty Finding'],
        detail: {
          severity: [{ numeric: ['>=', severityThreshold] }],
        },
      }),
      tags,
    },
    { provider },
  );

  // Deliberately no inputTransformer: Chatbot renders GuardDuty findings natively, and
  // flattening the event to a string would lose that.
  new aws.cloudwatch.EventTarget(
    `guardduty-findings-sns-${region}`,
    {
      rule: rule.name,
      arn: topic.arn,
    },
    { provider },
  );

  return topic.arn;
});

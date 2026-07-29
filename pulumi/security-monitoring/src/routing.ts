import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import {
  deliveryFailureEmail,
  findingRegions,
  severityThreshold,
  slackWebhookUrl,
  tags,
} from './config.ts';
import { regionProviders } from './providers.ts';

// A GuardDuty delegated administrator receives member-account findings on its own
// default event bus in each region, so one rule per region covers the organisation.
// Delivery is outbound-only: EventBridge posts to a Slack workflow trigger. Nothing
// grants Slack any path back into AWS.
export const deliveryFailureTopicArns = findingRegions.map((region) => {
  const provider = regionProviders[region];

  // API destinations require an authorization type even when the endpoint authenticates
  // by URL alone, as Slack workflow triggers do. Slack ignores the extra header.
  const connection = new aws.cloudwatch.EventConnection(
    `slack-webhook-${region}`,
    {
      authorizationType: 'API_KEY',
      authParameters: {
        apiKey: {
          key: 'X-Unused-Authorization',
          value: 'unused',
        },
      },
      description: 'Slack workflow trigger for GuardDuty findings (URL is the credential)',
    },
    { provider },
  );

  const destination = new aws.cloudwatch.EventApiDestination(
    `slack-findings-${region}`,
    {
      connectionArn: connection.arn,
      invocationEndpoint: slackWebhookUrl,
      httpMethod: 'POST',
      invocationRateLimitPerSecond: 10,
      description: 'Posts GuardDuty findings to the security Slack channel',
    },
    { provider },
  );

  const rule = new aws.cloudwatch.EventRule(
    `guardduty-findings-${region}`,
    {
      name: 'guardduty-severe-findings',
      description: `Forward GuardDuty findings at severity ${severityThreshold} and above to Slack`,
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

  const invokeRole = new aws.iam.Role(`eventbridge-slack-${region}`, {
    namePrefix: `eventbridge-slack-${region}-`,
    description: `Lets EventBridge in ${region} invoke the Slack API destination`,
    assumeRolePolicy: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'events.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    }),
    tags,
  });

  new aws.iam.RolePolicy(`eventbridge-slack-${region}`, {
    namePrefix: 'invoke-api-destination-',
    role: invokeRole.id,
    policy: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'events:InvokeApiDestination',
          Resource: destination.arn,
        },
      ],
    }),
  });

  // Without a dead-letter queue, an event that exhausts its retries is dropped with no
  // trace. A security notification path must not fail quietly.
  const deadLetters = new aws.sqs.Queue(
    `guardduty-findings-dlq-${region}`,
    {
      name: 'guardduty-findings-dlq',
      messageRetentionSeconds: 14 * 24 * 60 * 60,
      tags,
    },
    { provider },
  );

  new aws.sqs.QueuePolicy(
    `guardduty-findings-dlq-${region}`,
    {
      queueUrl: deadLetters.url,
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowEventBridgeDeadLetters',
            Effect: 'Allow',
            Principal: { Service: 'events.amazonaws.com' },
            Action: 'sqs:SendMessage',
            Resource: deadLetters.arn,
            Condition: {
              ArnEquals: { 'aws:SourceArn': rule.arn },
            },
          },
        ],
      }),
    },
    { provider },
  );

  new aws.cloudwatch.EventTarget(
    `guardduty-findings-slack-${region}`,
    {
      rule: rule.name,
      arn: destination.arn,
      roleArn: invokeRole.arn,
      retryPolicy: {
        maximumEventAgeInSeconds: 3600,
        maximumRetryAttempts: 10,
      },
      deadLetterConfig: {
        arn: deadLetters.arn,
      },
      // Slack workflow triggers take a flat JSON object whose keys must match the
      // variables declared on the workflow.
      inputTransformer: {
        inputPaths: {
          account: '$.detail.accountId',
          findingId: '$.detail.id',
          findingRegion: '$.region',
          findingType: '$.detail.type',
          description: '$.detail.description',
          severity: '$.detail.severity',
        },
        inputTemplate: `{
  "severity": "<severity>",
  "findingType": "<findingType>",
  "account": "<account>",
  "region": "<findingRegion>",
  "description": "<description>",
  "url": "https://console.aws.amazon.com/guardduty/home?region=<findingRegion>#/findings?search=id%3D<findingId>"
}`,
      },
    },
    { provider },
  );

  // Alarm actions must live in the alarm's own region, hence a topic per region.
  const deliveryFailures = new aws.sns.Topic(
    `guardduty-delivery-failures-${region}`,
    {
      name: 'guardduty-delivery-failures',
      displayName: 'GuardDuty Slack delivery failures',
      tags,
    },
    { provider },
  );

  new aws.sns.TopicSubscription(
    `guardduty-delivery-failures-${region}`,
    {
      topic: deliveryFailures.arn,
      protocol: 'email',
      endpoint: deliveryFailureEmail,
    },
    { provider },
  );

  new aws.cloudwatch.MetricAlarm(
    `guardduty-findings-dlq-${region}`,
    {
      name: 'guardduty-findings-undelivered',
      alarmDescription: interpolate`GuardDuty findings in ${region} failed to reach Slack and are sitting in ${deadLetters.name}`,
      namespace: 'AWS/SQS',
      metricName: 'ApproximateNumberOfMessagesVisible',
      dimensions: { QueueName: deadLetters.name },
      statistic: 'Maximum',
      period: 300,
      evaluationPeriods: 1,
      comparisonOperator: 'GreaterThanThreshold',
      threshold: 0,
      treatMissingData: 'notBreaching',
      alarmActions: [deliveryFailures.arn],
      okActions: [deliveryFailures.arn],
      tags,
    },
    { provider },
  );

  return deliveryFailures.arn;
});

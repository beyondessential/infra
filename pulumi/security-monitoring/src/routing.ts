import { asset, interpolate, jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { accountId } from '../../common/awsAccount.ts';
import {
  deliveryFailureEmail,
  findingRegions,
  severityThreshold,
  slackWebhookUrl,
  tags,
} from './config.ts';
import { NOTIFIER_CODE } from './notifierCode.ts';
import { nativeProvider, regionProviders } from './providers.ts';

const NOTIFIER_NAME = 'guardduty-slack-notifier';

// One topic for every region. CloudWatch alarm actions may target a topic in another
// region as long as its policy allows the publish, so a single subscription — and a
// single manual confirmation — covers the whole stack. Reports that findings are not
// reaching Slack, so it is deliberately email rather than Slack.
const deliveryFailures = new aws.sns.Topic('guardduty-alert-delivery-failures', {
  name: 'guardduty-alert-delivery-failures',
  displayName: 'GuardDuty Slack delivery failures',
  tags,
});

new aws.sns.TopicPolicy('guardduty-alert-delivery-failures', {
  arn: deliveryFailures.arn,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowCloudWatchAlarmsInThisAccount',
        Effect: 'Allow',
        Principal: { Service: 'cloudwatch.amazonaws.com' },
        Action: 'SNS:Publish',
        Resource: deliveryFailures.arn,
        Condition: { StringEquals: { 'aws:SourceAccount': accountId } },
      },
    ],
  }),
});

new awsNative.sns.Subscription(
  'guardduty-alert-delivery-failures-email',
  {
    topicArn: deliveryFailures.arn,
    protocol: 'email',
    endpoint: deliveryFailureEmail,
  },
  { provider: nativeProvider },
);

export const deliveryFailureTopicArn = deliveryFailures.arn;

// A GuardDuty delegated administrator receives member-account findings on its own
// default event bus in each region, so one rule per region covers the organisation.
// Delivery is outbound only: the notifier POSTs to a Slack workflow trigger. Nothing
// grants Slack a path back into AWS.
for (const region of findingRegions) {
  const provider = regionProviders[region];

  // Events that exhaust their retries land here rather than vanishing. A security
  // notification path must not fail quietly.
  const deadLetters = new aws.sqs.Queue(
    `guardduty-findings-dlq-${region}`,
    {
      name: 'guardduty-findings-dlq',
      messageRetentionSeconds: 14 * 24 * 60 * 60,
      tags,
    },
    { provider },
  );

  const notifierRole = new aws.iam.Role(`guardduty-slack-notifier-${region}`, {
    // IAM is global so the region has to be in the name, and namePrefix caps at 38.
    namePrefix: `guardduty-notifier-${region}-`,
    description: `Role for the GuardDuty Slack notifier in ${region}`,
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
    tags,
  });

  new aws.iam.RolePolicy(`guardduty-slack-notifier-${region}`, {
    namePrefix: 'notify-slack-',
    role: notifierRole.id,
    policy: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'organizations:DescribeAccount',
          Resource: '*',
        },
        {
          Effect: 'Allow',
          Action: 'sqs:SendMessage',
          Resource: deadLetters.arn,
        },
        {
          Effect: 'Allow',
          Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          Resource: 'arn:aws:logs:*:*:*',
        },
      ],
    }),
  });

  // Declared so logs expire; Lambda would otherwise create this with no expiry.
  new aws.cloudwatch.LogGroup(
    `guardduty-slack-notifier-${region}`,
    {
      name: `/aws/lambda/${NOTIFIER_NAME}`,
      retentionInDays: 30,
      tags,
    },
    { provider },
  );

  const notifier = new aws.lambda.Function(
    `guardduty-slack-notifier-${region}`,
    {
      name: NOTIFIER_NAME,
      description: 'Enriches GuardDuty findings with the account name and posts to Slack',
      runtime: 'python3.12',
      handler: 'index.handler',
      timeout: 30,
      memorySize: 256,
      role: notifierRole.arn,
      code: new asset.AssetArchive({ 'index.py': new asset.StringAsset(NOTIFIER_CODE) }),
      environment: {
        variables: {
          SLACK_WEBHOOK_URL: slackWebhookUrl,
        },
      },
      tags,
    },
    { provider },
  );

  // EventBridge invokes asynchronously, so execution failures are retried by Lambda
  // and then dead-lettered here.
  new aws.lambda.FunctionEventInvokeConfig(
    `guardduty-slack-notifier-${region}`,
    {
      functionName: notifier.name,
      maximumRetryAttempts: 2,
      destinationConfig: {
        onFailure: {
          destination: deadLetters.arn,
        },
      },
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

  new aws.lambda.Permission(
    `guardduty-slack-notifier-${region}`,
    {
      action: 'lambda:InvokeFunction',
      function: notifier.name,
      principal: 'events.amazonaws.com',
      sourceArn: rule.arn,
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
    `guardduty-findings-notifier-${region}`,
    {
      rule: rule.name,
      arn: notifier.arn,
      retryPolicy: {
        maximumEventAgeInSeconds: 3600,
        maximumRetryAttempts: 10,
      },
      deadLetterConfig: {
        arn: deadLetters.arn,
      },
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
      // No okActions: with treatMissingData notBreaching the alarm goes straight to OK
      // about a minute after creation, which would publish a notification saying
      // nothing. That notification carries List-Unsubscribe headers, and one-click
      // unsubscribe in a mail client silently kills the only out-of-band alert path.
      alarmActions: [deliveryFailures.arn],
      tags,
    },
    { provider },
  );

  new aws.cloudwatch.MetricAlarm(
    `guardduty-slack-notifier-errors-${region}`,
    {
      name: 'guardduty-slack-notifier-errors',
      alarmDescription: `The GuardDuty Slack notifier in ${region} is erroring`,
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensions: { FunctionName: NOTIFIER_NAME },
      statistic: 'Sum',
      period: 300,
      evaluationPeriods: 1,
      comparisonOperator: 'GreaterThanThreshold',
      threshold: 0,
      treatMissingData: 'notBreaching',
      alarmActions: [deliveryFailures.arn],
      tags,
    },
    { provider },
  );
}

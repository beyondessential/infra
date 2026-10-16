import { asset, jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { slackWebhookUrl, tags } from './config.ts';
import { NOTIFIER_CODE } from './notifierCode.ts';
import { centralEventBus, centralEventRule, snsTopic, workloadAlertsCentral } from './central.ts';

const NOTIFIER_NAME = 'ops-slack-notifier';

// Failures here are reported through the existing backup-failure topic, which already
// has a confirmed email subscription — deliberately not through Slack, so a broken
// notifier still reaches someone.
const deadLetters = new aws.sqs.Queue('ops-slack-notifier-dlq', {
  name: 'ops-slack-notifier-dlq',
  messageRetentionSeconds: 14 * 24 * 60 * 60,
  tags,
});

const role = new aws.iam.Role('ops-slack-notifier', {
  namePrefix: 'ops-slack-notifier-',
  description: 'Role for the ops Slack notifier',
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
  tags,
});

new aws.iam.RolePolicy('ops-slack-notifier', {
  namePrefix: 'notify-slack-',
  role: role.id,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'organizations:DescribeAccount', Resource: '*' },
      { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: deadLetters.arn },
      {
        Effect: 'Allow',
        Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: 'arn:aws:logs:*:*:*',
      },
    ],
  }),
});

new aws.cloudwatch.LogGroup('ops-slack-notifier', {
  name: `/aws/lambda/${NOTIFIER_NAME}`,
  retentionInDays: 30,
  tags,
});

const notifier = new aws.lambda.Function('ops-slack-notifier', {
  name: NOTIFIER_NAME,
  description: 'Posts AWS Backup failures and member-account alarms to Slack',
  runtime: 'python3.12',
  handler: 'index.handler',
  timeout: 30,
  memorySize: 256,
  role: role.arn,
  code: new asset.AssetArchive({ 'index.py': new asset.StringAsset(NOTIFIER_CODE) }),
  environment: { variables: { SLACK_WEBHOOK_URL: slackWebhookUrl! } },
  tags,
});

new aws.lambda.FunctionEventInvokeConfig('ops-slack-notifier', {
  functionName: notifier.name,
  maximumRetryAttempts: 2,
  destinationConfig: { onFailure: { destination: deadLetters.arn } },
});

// Backup failures come off the central rule as a second target, so the existing email
// path keeps its own input transformer and the notifier sees the structured event.
new aws.cloudwatch.EventTarget('backup-failure-notifier-target', {
  rule: centralEventRule.name,
  eventBusName: centralEventBus.name,
  arn: notifier.arn,
  deadLetterConfig: { arn: deadLetters.arn },
});

new aws.lambda.Permission('ops-slack-notifier-events', {
  action: 'lambda:InvokeFunction',
  function: notifier.name,
  principal: 'events.amazonaws.com',
  sourceArn: centralEventRule.arn,
});

// Member-account CloudWatch alarms publish straight to SNS, so subscribe there.
new aws.sns.TopicSubscription('workload-alerts-central-notifier', {
  topic: workloadAlertsCentral.topicArn,
  protocol: 'lambda',
  endpoint: notifier.arn,
});

new aws.lambda.Permission('ops-slack-notifier-workload-alerts', {
  action: 'lambda:InvokeFunction',
  function: notifier.name,
  principal: 'sns.amazonaws.com',
  sourceArn: workloadAlertsCentral.topicArn,
});

new aws.cloudwatch.MetricAlarm('ops-slack-notifier-errors', {
  name: 'ops-slack-notifier-errors',
  alarmDescription: 'The ops Slack notifier is erroring, so alerts may not be reaching Slack',
  namespace: 'AWS/Lambda',
  metricName: 'Errors',
  dimensions: { FunctionName: NOTIFIER_NAME },
  statistic: 'Sum',
  period: 300,
  evaluationPeriods: 1,
  comparisonOperator: 'GreaterThanThreshold',
  threshold: 0,
  treatMissingData: 'notBreaching',
  alarmActions: [snsTopic.topicArn],
  tags,
});

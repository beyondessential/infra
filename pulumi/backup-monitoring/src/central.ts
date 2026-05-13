import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { nativeTags } from '../../common/tags.ts';
import { AWS_ORG_ID } from '../../constants/internal.ts';
import { monitoringEmail, tags } from './config.ts';

const centralEventBus = new aws.cloudwatch.EventBus('backup-failures', {
  name: 'backup-failures',
  tags,
});

new aws.cloudwatch.EventBusPolicy('backup-failures-org-policy', {
  eventBusName: centralEventBus.name,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowOrganizationAccounts',
        Effect: 'Allow',
        Principal: '*',
        Action: 'events:PutEvents',
        Resource: centralEventBus.arn,
        Condition: {
          StringEquals: {
            'aws:PrincipalOrgID': AWS_ORG_ID,
          },
        },
      },
    ],
  }),
});

const snsTopic = new awsNative.sns.Topic('backup-failure-notifications', {
  topicName: 'backup-failure-notifications',
  displayName: 'AWS Backup Failure Notifications',
  tags: nativeTags(tags),
});

new awsNative.sns.Subscription('backup-failure-email', {
  topicArn: snsTopic.topicArn,
  protocol: 'email',
  endpoint: monitoringEmail,
});

new aws.sns.TopicPolicy('backup-failure-topic-policy', {
  arn: snsTopic.topicArn,
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
        Resource: snsTopic.topicArn,
      },
    ],
  }),
});

const centralEventRule = new aws.cloudwatch.EventRule(
  'central-backup-failure-rule',
  {
    name: 'central-backup-failure-notifications',
    description: 'Central rule to forward backup failures to SNS',
    eventBusName: centralEventBus.name,
    eventPattern: jsonStringify({
      source: ['aws.backup'],
      'detail-type': ['Backup Job State Change'],
      detail: {
        state: ['FAILED', 'ABORTED', 'EXPIRED'],
      },
    }),
    tags,
  },
  {
    dependsOn: [centralEventBus],
  },
);

new aws.cloudwatch.EventTarget('backup-failure-sns-target', {
  rule: centralEventRule.name,
  eventBusName: centralEventBus.name,
  arn: snsTopic.topicArn,
  inputTransformer: {
    inputPaths: {
      account: '$.account',
      region: '$.region',
      state: '$.detail.state',
      resourceArn: '$.detail.resourceArn',
      backupJobId: '$.detail.backupJobId',
      startTime: '$.detail.startTime',
      completionTime: '$.detail.completionTime',
      statusMessage: '$.detail.statusMessage',
    },
    inputTemplate: `"AWS Backup Job Failed\\n\\nAccount: <account>\\nRegion: <region>\\nStatus: <state>\\nResource: <resourceArn>\\nBackup Job ID: <backupJobId>\\nStart Time: <startTime>\\nCompletion Time: <completionTime>\\nMessage: <statusMessage>"`,
  },
});

export const eventBusArn = centralEventBus.arn;
export const eventBusName = centralEventBus.name;
export const snsTopicArn = snsTopic.topicArn;

export const workloadAlertsCentral = new awsNative.sns.Topic('workload-alerts-central', {
  topicName: 'workload-alerts-central',
  displayName: 'Workload Alerts (org-wide)',
  tags: nativeTags(tags),
});

new aws.sns.TopicPolicy('workload-alerts-central-policy', {
  arn: workloadAlertsCentral.topicArn,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowOrgCloudWatchPublish',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudwatch.amazonaws.com',
        },
        Action: 'SNS:Publish',
        Resource: workloadAlertsCentral.topicArn,
        Condition: {
          StringEquals: {
            'aws:PrincipalOrgID': AWS_ORG_ID,
          },
        },
      },
    ],
  }),
});

export const workloadAlertsCentralArn = workloadAlertsCentral.topicArn;

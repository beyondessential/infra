import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

import { tags, slackChannelId, slackTeamId } from './config.ts';
import { snsTopicArn, workloadAlertsCentralArn } from './central.ts';

if (!slackTeamId || !slackChannelId) {
  throw new Error(
    'backup-monitoring: slackTeamId and slackChannelId must be set in stack config; ' +
      'authorize the Slack workspace via AWS Chatbot in the primary account console first.',
  );
}

const role = new aws.iam.Role('chatbot-aws-alerts', {
  namePrefix: 'chatbot-aws-alerts-',
  description: 'Role assumed by AWS Chatbot to deliver ops alerts to Slack',
  assumeRolePolicy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'chatbot.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
  managedPolicyArns: ['arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess'],
  tags,
});

new aws.chatbot.SlackChannelConfiguration('aws-alerts', {
  configurationName: 'aws-alerts',
  slackTeamId,
  slackChannelId,
  iamRoleArn: role.arn,
  snsTopicArns: [snsTopicArn, workloadAlertsCentralArn],
  loggingLevel: 'INFO',
  tags,
});

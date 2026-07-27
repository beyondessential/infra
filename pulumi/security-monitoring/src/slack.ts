import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

import { slackChannelId, slackTeamId, tags } from './config.ts';
import { chatbotProvider } from './providers.ts';
import { findingTopicArns } from './routing.ts';

if (!slackTeamId || !slackChannelId) {
  throw new Error(
    'security-monitoring: slackTeamId and slackChannelId must be set in stack config; ' +
      'authorize the Slack workspace via AWS Chatbot in the primary account console first.',
  );
}

const role = new aws.iam.Role('chatbot-aws-security', {
  namePrefix: 'chatbot-aws-security-',
  description: 'Role assumed by AWS Chatbot to deliver GuardDuty findings to Slack',
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

new aws.chatbot.SlackChannelConfiguration(
  'aws-security',
  {
    configurationName: 'aws-security',
    slackTeamId,
    slackChannelId,
    iamRoleArn: role.arn,
    // Channel guardrails cap what channel members can run as chat commands. Left
    // unset, AWS applies AdministratorAccess. This channel only needs to receive
    // notifications, so cap it at the same read-only scope as the role above.
    guardrailPolicyArns: ['arn:aws:iam::aws:policy/CloudWatchReadOnlyAccess'],
    snsTopicArns: findingTopicArns,
    loggingLevel: 'INFO',
    tags,
  },
  { provider: chatbotProvider },
);

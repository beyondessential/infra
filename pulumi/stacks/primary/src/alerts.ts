import * as aws from '@pulumi/aws';
import { accountId } from '../../common/awsAccount.ts';
import { jsonStringify } from '@pulumi/pulumi';

const org = aws.organizations.getOrganizationOutput({});

export const topic = new aws.sns.Topic('workload-alerts');

new aws.sns.TopicSubscription(
  'send-to-devlead',
  {
    topic: topic.arn,
    protocol: 'email',
    endpoint: 'felix+aws-alerts@bes.au',
  },
  { parent: topic },
);

new aws.sns.TopicPolicy(
  'workload-alerts-policy',
  {
    arn: topic.arn,
    policy: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: '__default_statement_ID',
          Effect: 'Allow',
          Principal: {
            AWS: '*',
          },
          Action: [
            'SNS:Publish',
            'SNS:RemovePermission',
            'SNS:SetTopicAttributes',
            'SNS:DeleteTopic',
            'SNS:ListSubscriptionsByTopic',
            'SNS:GetTopicAttributes',
            'SNS:AddPermission',
            'SNS:Subscribe',
          ],
          Resource: topic.arn,
          Condition: {
            StringEquals: {
              'AWS:SourceAccount': accountId,
            },
          },
        },
        {
          Sid: 'AllowCrossAccountPublish',
          Effect: 'Allow',
          Principal: {
            AWS: '*',
          },
          Action: ['sns:Publish'],
          Resource: topic.arn,
          Condition: {
            StringEquals: {
              'aws:PrincipalOrgID': org.id,
            },
          },
        },
      ],
    }),
  },
  { parent: topic },
);

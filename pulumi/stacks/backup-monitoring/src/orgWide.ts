import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { tags } from './config.ts';
import { eventBusArn } from './central.ts';
import { nativeTitlecaseTags } from '../../common/tags.ts';
import { AWS_ROOT_ID } from '../../constants/internal.ts';
import { region } from '../../common/awsAccount.ts';

export const stackSetTemplate = (name: string) =>
  jsonStringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'AWS Backup failure monitoring - forwards backup failures to central event bus',
    Resources: {
      [`${name}BackupFailureEventRule`]: {
        Type: 'AWS::Events::Rule',
        Properties: {
          Name: `backup-${name.toLowerCase()}-failure-notifications`,
          Description: `Detect AWS Backup (${name}) job failures and forward to central event bus`,
          State: 'ENABLED',
          EventPattern: {
            source: ['aws.backup'],
            'detail-type': ['Backup Job State Change'],
            detail: {
              state: ['FAILED', 'ABORTED', 'EXPIRED'],
            },
          },
          Targets: [
            {
              Arn: eventBusArn,
              Id: 'CentralEventBus',
              RoleArn: { 'Fn::GetAtt': [`${name}BackupFailureEventRole`, 'Arn'] },
            },
          ],
        },
      },
      [`${name}BackupFailureEventRole`]: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: `${name}BackupFailureEventBridgeRole`,
          Description: `Allows EventBridge to send backup (${name}) failure events to central event bus`,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  Service: 'events.amazonaws.com',
                },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'PutEventsToCentral',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: 'events:PutEvents',
                    Resource: eventBusArn,
                  },
                ],
              },
            },
          ],
          Tags: nativeTitlecaseTags(tags),
        },
      },
    },
    Outputs: {
      EventRuleName: {
        Description: `Name of the backup (${name}) failure EventBridge rule`,
        Value: { Ref: `${name}BackupFailureEventRule` },
      },
      EventRuleArn: {
        Description: `ARN of the backup (${name}) failure EventBridge rule`,
        Value: { 'Fn::GetAtt': [`${name}BackupFailureEventRule`, 'Arn'] },
      },
    },
  });

const backupMonitoringStackSet = new aws.cloudformation.StackSet('backup-monitoring-orgwide', {
  description: 'Deploys backup failure monitoring to all member accounts in the organization',
  templateBody: stackSetTemplate('Orgwide'),
  permissionModel: 'SERVICE_MANAGED',
  autoDeployment: {
    enabled: true,
    retainStacksOnAccountRemoval: false,
  },
  capabilities: ['CAPABILITY_NAMED_IAM'],
  operationPreferences: {
    maxConcurrentCount: 10,
    failureToleranceCount: 5,
    regionConcurrencyType: 'PARALLEL',
  },
});

new aws.cloudformation.StackSetInstance(
  'backup-monitoring-org-instances-apsoutheast2',
  {
    stackSetName: backupMonitoringStackSet.name,
    deploymentTargets: {
      organizationalUnitIds: [AWS_ROOT_ID],
    },
    region,
    operationPreferences: {
      maxConcurrentCount: 10,
      failureToleranceCount: 5,
      regionConcurrencyType: 'PARALLEL',
    },
  },
  {
    dependsOn: [backupMonitoringStackSet],
  },
);

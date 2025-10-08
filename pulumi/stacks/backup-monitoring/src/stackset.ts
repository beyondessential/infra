import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { tags, euCentral2Accounts } from './config.ts';
import { eventBusArn } from './central.ts';
import { nativeTitlecaseTags } from '../../common/tags.ts';
import { AWS_ROOT_ID } from '../../constants/internal.ts';

const organizationalUnits = aws.organizations.getOrganizationalUnitsOutput({
  parentId: AWS_ROOT_ID,
});

const orgUnitIds = organizationalUnits.children.apply((children) =>
  children.filter((child) => /archive/i.test(child.name)).map((child) => child.id),
);

const stackSetTemplate = jsonStringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'AWS Backup failure monitoring - forwards backup failures to central event bus',
  Resources: {
    BackupFailureEventRule: {
      Type: 'AWS::Events::Rule',
      Properties: {
        Name: 'backup-failure-notifications',
        Description: 'Detect AWS Backup job failures and forward to central event bus',
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
            RoleArn: { 'Fn::GetAtt': ['BackupFailureEventRole', 'Arn'] },
          },
        ],
      },
    },
    BackupFailureEventRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'BackupFailureEventBridgeRole',
        Description: 'Allows EventBridge to send backup failure events to central event bus',
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
            PolicyName: 'PutEventsTocentral',
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
      Description: 'Name of the backup failure EventBridge rule',
      Value: { Ref: 'BackupFailureEventRule' },
    },
    EventRuleArn: {
      Description: 'ARN of the backup failure EventBridge rule',
      Value: { 'Fn::GetAtt': ['BackupFailureEventRule', 'Arn'] },
    },
  },
});

const backupMonitoringStackSet = new aws.cloudformation.StackSet(
  'backup-monitoring-member-accounts',
  {
    name: 'BackupFailureMonitoring',
    description: 'Deploys backup failure monitoring to all member accounts in the organization',
    templateBody: stackSetTemplate,
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
  },
);

new aws.cloudformation.StackSetInstance(
  'backup-monitoring-org-instances-apsoutheast2',
  {
    stackSetName: backupMonitoringStackSet.name,
    deploymentTargets: {
      organizationalUnitIds: orgUnitIds,
    },
    region: 'ap-southeast-2',
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

if (euCentral2Accounts.length > 0) {
  new aws.cloudformation.StackSetInstance(
    'backup-monitoring-org-instances-eucentral2',
    {
      stackSetName: backupMonitoringStackSet.name,
      deploymentTargets: {
        accountFilterType: 'INTERSECTION',
        organizationalUnitIds: orgUnitIds,
        accounts: euCentral2Accounts,
      },
      region: 'eu-central-2',
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
}

export const stackSetName = backupMonitoringStackSet.name;
export const stackSetId = backupMonitoringStackSet.stackSetId;

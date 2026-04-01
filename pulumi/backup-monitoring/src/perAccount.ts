import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { tags, euCentral2Accounts } from './config.ts';
import { nativeTitlecaseTags } from '../../common/tags.ts';
import { stackSetTemplate } from './orgWide.ts';
import { accountId, region } from '../../common/awsAccount.ts';
import { AWS_ROOT_ID } from '../../constants/internal.ts';

const executionRoleName = 'BackupMonitoringStackSetExecutionRole';

const adminRole = new aws.iam.Role('stackset-admin-role', {
  namePrefix: 'backup-monitoring-',
  description: 'CloudFormation StackSet administration role for BackupMonitoring',
  assumeRolePolicy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: 'cloudformation.amazonaws.com',
        },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
  tags,
});

new aws.iam.RolePolicy('stackset-admin-policy', {
  namePrefix: 'backup-monitoring-',
  role: adminRole.id,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Resource: `arn:aws:iam::*:role/${executionRoleName}`,
      },
    ],
  }),
});

const executionRoleTemplate = jsonStringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'CloudFormation StackSet execution role for BackupMonitoring SELF_MANAGED StackSets',
  Resources: {
    ExecutionRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: executionRoleName,
        Description: 'CloudFormation StackSet execution role',
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                AWS: {
                  'Fn::Sub': interpolate`arn:aws:iam::${accountId}:role/${adminRole.name}`,
                },
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        ManagedPolicyArns: ['arn:aws:iam::aws:policy/AdministratorAccess'],
        Tags: nativeTitlecaseTags(tags),
      },
    },
  },
});

const executionRoleStackSet = new aws.cloudformation.StackSet(
  'backup-monitoring-peraccount-roles',
  {
    description: 'Deploys execution roles for BackupMonitoring SELF_MANAGED StackSets',
    templateBody: executionRoleTemplate,
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
  {
    dependsOn: [adminRole],
  },
);

const executionRoleInstance = new aws.cloudformation.StackSetInstance(
  'stackset-execution-roles-instances',
  {
    stackSetName: executionRoleStackSet.name,
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
);

const backupMonitoringSelfManagedStackSet = new aws.cloudformation.StackSet(
  'backup-monitoring-peraccount',
  {
    description: 'Deploys backup failure monitoring to specific accounts (SELF_MANAGED)',
    templateBody: stackSetTemplate('Peraccount'),
    permissionModel: 'SELF_MANAGED',
    administrationRoleArn: adminRole.arn,
    executionRoleName,
    capabilities: ['CAPABILITY_NAMED_IAM'],
    operationPreferences: {
      maxConcurrentCount: 10,
      failureToleranceCount: 5,
      regionConcurrencyType: 'PARALLEL',
    },
  },
  {
    dependsOn: [executionRoleStackSet],
  },
);

if (euCentral2Accounts.length > 0) {
  for (const accountId of euCentral2Accounts) {
    new aws.cloudformation.StackSetInstance(
      `backup-monitoring-peraccount-eucentral2-${accountId}`,
      {
        stackSetName: backupMonitoringSelfManagedStackSet.name,
        accountId,
        region: 'eu-central-2',
        operationPreferences: {
          maxConcurrentCount: 10,
          failureToleranceCount: 5,
          regionConcurrencyType: 'PARALLEL',
        },
      },
      {
        dependsOn: [executionRoleInstance],
      },
    );
  }
}

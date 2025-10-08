import * as aws from '@pulumi/aws';
import { DRATA_AWS_ACCOUNT_ARN, drataExternalId, ROOT_ID, tags } from './config.ts';
import { additionalPermissions, assumeRole, policy } from './role.ts';
import { jsonStringify } from '@pulumi/pulumi';
import { nativeTitlecaseTags } from '../../common/tags.ts';

const stackSetTemplate = jsonStringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description:
    'Drata Autopilot Role - Cross-account read-only access for Drata compliance monitoring',
  Resources: {
    DrataAdditionalPermissions: {
      Type: 'AWS::IAM::ManagedPolicy',
      Properties: {
        ManagedPolicyName: additionalPermissions.managedPolicyName,
        Description: 'Custom policy for permissions in addition to the SecurityAudit policy',
        PolicyDocument: policy,
      },
    },
    DrataAutopilotRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: 'DrataAutopilotRole',
        Path: '/',
        Description: 'Cross-account read-only access for Drata Autopilot',
        ManagedPolicyArns: [
          'arn:aws:iam::aws:policy/SecurityAudit',
          { Ref: additionalPermissions.managedPolicyName },
        ],
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'sts:AssumeRole',
              Principal: {
                AWS: DRATA_AWS_ACCOUNT_ARN,
              },
              Condition: {
                StringEquals: {
                  'sts:ExternalId': drataExternalId,
                },
              },
            },
          ],
        },
        Tags: nativeTitlecaseTags(tags),
      },
    },
  },
  Outputs: {
    RoleArn: {
      Description: 'ARN of the Drata Autopilot Role',
      Value: { 'Fn::GetAtt': ['DrataAutopilotRole', 'Arn'] },
    },
    RoleName: {
      Description: 'Name of the Drata Autopilot Role',
      Value: { Ref: 'DrataAutopilotRole' },
    },
  },
});

const drataStackSet = new aws.cloudformation.StackSet(
  'drata-member-accounts',
  {
    name: 'DrataAutopilotRole',
    description: 'Deploys Drata Autopilot Role to all member accounts in the organization',
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
    },
    callAs: 'SELF',
  },
  {
    // Ensure management account role is created first
    dependsOn: [assumeRole],
  },
);

new aws.cloudformation.StackSetInstance(
  'drata-org-instances',
  {
    stackSetName: drataStackSet.name,
    deploymentTargets: {
      organizationalUnitIds: [ROOT_ID], // Deploys to root OU (all accounts)
    },
    regions: ['ap-southeast-2'], // Must match the region where old stacks were deployed
    operationPreferences: {
      maxConcurrentCount: 10,
      failureToleranceCount: 5,
    },
    callAs: 'SELF',
  },
  {
    dependsOn: [drataStackSet],
  },
);

export const stackSetName = drataStackSet.name;
export const stackSetId = drataStackSet.stackSetId;

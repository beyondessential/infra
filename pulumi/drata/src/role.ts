import { jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';
import { nativeTags } from '../../common/tags.ts';
import { DRATA_AWS_ACCOUNT_ARN, drataExternalId, tags } from './config.ts';

export const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['backup:ListBackupJobs', 'backup:ListRecoveryPointsByResource'],
      Resource: '*',
    },
    {
      Effect: 'Allow',
      Action: ['organizations:Describe*', 'organizations:List*'],
      Resource: '*',
    },
  ],
};

export const additionalPermissions = new awsNative.iam.ManagedPolicy(
  'additional-permissions',
  {
    managedPolicyName: 'DrataAdditionalPermissions',
    description: 'Custom policy for permissions in addition to the SecurityAudit policy',
    policyDocument: jsonStringify(policy),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

export const assumeRole = new awsNative.iam.Role('assume-role', {
  roleName: 'DrataAutopilotRole',
  path: '/',
  description: 'Cross-account read-only access for Drata Autopilot',
  tags: nativeTags(tags),
  managedPolicyArns: ['arn:aws:iam::aws:policy/SecurityAudit', additionalPermissions.policyArn],
  assumeRolePolicyDocument: jsonStringify({
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
            'sts:ExternalId': [drataExternalId],
          },
        },
      },
    ],
  }),
});

export const assumeRoleName = assumeRole.roleName;
export const assumeRoleArn = assumeRole.arn;

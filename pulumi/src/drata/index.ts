import { Config, jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';
import { nativeTags } from '../common/tags.js';

const config = new Config();
const drataExternalId = config.requireSecret('drataExternalId');
const DRATA_AWS_ACCOUNT_ARN = 'arn:aws:iam::269135526815:root';

const tags = {
  Purpose: 'audit',
  ...((config.getObject('tags') as object) ?? {}),
};

const additionalPermissions = new awsNative.iam.ManagedPolicy('additional-permissions', {
  managedPolicyName: 'DrataAdditionalPermissions',
  description: 'Custom policy for permissions in addition to the SecurityAudit policy',
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['backup:ListBackupJobs', 'backup:ListRecoveryPointsByResource'],
        Resource: '*',
      },
    ],
  }),
});

const assumeRole = new awsNative.iam.Role('assume-role', {
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

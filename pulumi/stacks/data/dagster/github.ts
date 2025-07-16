import { jsonStringify, interpolate } from '@pulumi/pulumi';
import { Role, ManagedPolicy } from '@pulumi/aws-native/iam/index.js';
import { AWS_STS } from '../../constants/external.ts';
import { ghaOidc } from '../../common/coreRef.ts';
import { accountId } from '../../common/awsAccount.ts';

const dagsterDeployPolicy = new ManagedPolicy('gha-dagster-deploy-policy', {
  managedPolicyName: 'DagsterDeployPolicy',
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['ec2:DescribeInstances'],
        Resource: '*',
      },
      {
        Effect: 'Allow',
        Action: ['ssm:SendCommand'],
        Resource: ['arn:aws:ssm:*:*:document/AWS-RunShellScript'],
      },
      {
        Effect: 'Allow',
        Action: ['ssm:SendCommand'],
        Resource: ['arn:aws:ec2:*:*:instance/*'],
        Condition: {
          StringLike: {
            'ssm:resourceTag/DeploymentType': ['dagster-server'],
          },
        },
      },
      {
        Effect: 'Allow',
        Action: [
          'lambda:ListProvisionedConcurrencyConfigs',
          'lambda:ListFunctionEventInvokeConfigs',
          'lambda:ListFunctionsByCodeSigningConfig',
          'lambda:InvokeFunction',
          'lambda:ListVersionsByFunction',
          'lambda:ListAliases',
          'lambda:ListFunctionUrlConfigs',
        ],
        Resource: [interpolate`arn:aws:lambda:*:${accountId}:function:deployment`],
      },
      {
        Effect: 'Allow',
        Action: [
          'lambda:ListFunctions',
          'lambda:ListEventSourceMappings',
          'lambda:ListLayerVersions',
          'lambda:ListLayers',
          'lambda:GetAccountSettings',
          'lambda:ListCodeSigningConfigs',
          'lambda:ListTags',
        ],
        Resource: ['*'],
      },
    ],
  }),
});

export const ghaDagsterRole = new Role('gha-oidc-role', {
  roleName: 'gha-dagster-deploy',
  assumeRolePolicyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: ghaOidc.arn,
        },
        Condition: ghaOidc.url.apply((url) => ({
          StringEquals: {
            [`${url}:aud`]: AWS_STS,
          },
          StringLike: {
            [`${url}:sub`]: ['repo:beyondessential/data-lake:ref:*'],
          },
        })),
      },
    ],
  }),
  managedPolicyArns: [dagsterDeployPolicy.policyArn],
});

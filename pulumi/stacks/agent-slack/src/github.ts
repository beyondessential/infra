import { jsonStringify, interpolate } from '@pulumi/pulumi';
import { Role } from '@pulumi/aws/iam/index.js';
import { clusterName, region } from '../../common/k8s/coreRef.ts';
import { AWS_STS } from '../../constants/external.ts';
import { namespace } from './namespace.ts';
import { accountId } from '../../common/awsAccount.ts';
import * as aws from '@pulumi/aws';

const oidcProvider = aws.iam.getOpenIdConnectProviderOutput({
  url: 'https://token.actions.githubusercontent.com',
});

const ghaClaims = ['repo:beyondessential/agent-slack:ref:refs/heads/main'];

export const role = new Role('github-actions-deploy', {
  name: 'gha-agent-slack-deploy',
  assumeRolePolicy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: oidcProvider.arn,
        },
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': AWS_STS,
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': ghaClaims,
          },
        },
      },
    ],
  }),
  inlinePolicies: [
    {
      name: 'AgentSlackDeploy',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['eks:DescribeCluster'],
            Resource: interpolate`arn:aws:eks:${region}:${accountId}:cluster/${clusterName}`,
          },
          {
            Effect: 'Allow',
            Action: ['sts:GetCallerIdentity'],
            Resource: '*',
          },
        ],
      }),
    },
  ],
});

export const roleArn = role.arn;
export const clusterNameOutput = clusterName;
export const namespaceOutput = namespace;
export const regionOutput = region;

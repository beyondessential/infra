import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { AWS_STS } from '../../constants/external.js';

new awsClassic.iam.Role('gha-ops-scripts-s3', {
  name: 'gha-ops-scripts-s3',
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: 'arn:aws:iam::143295493206:oidc-provider/token.actions.githubusercontent.com',
        },
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': AWS_STS,
            'token.actions.githubusercontent.com:sub':
              'repo:beyondessential/ops:ref:refs/heads/main',
          },
        },
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'OpsScriptsPush',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
            Resource: [
              'bes-ops-tools',
              'bes-tamanu-release-clients',
              'bes-tamanu-release-servers',
            ].flatMap((bucket) => [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`]),
          },
        ],
      }),
    },
  ],
});

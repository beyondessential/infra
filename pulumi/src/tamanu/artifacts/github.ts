import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { ghaOidc } from '../../common/coreRef.js';
import { AWS_STS, AWS_S3_WRITE_ACTIONS } from '../../constants/external.js';

const TOOLS_BUCKET = 'bes-ops-tools';

new awsClassic.iam.Role('gha-ops-pglies-s3', {
  name: 'gha-ops-pglies-s3',
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: 'arn:aws:iam::143295493206:oidc-provider/token.actions.githubusercontent.com',
        },
        Condition: ghaOidc.url.apply((url) => ({
          StringEquals: {
            [`${url}:aud`]: AWS_STS,
          },
          StringLike: {
            [`${url}:sub`]: [
              'repo:beyondessential/pg_lies:ref:refs/heads/main',
              'repo:beyondessential/pg_lies:ref:refs/heads/tav-889',
            ],
          },
        })),
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
            Action: AWS_S3_WRITE_ACTIONS,
            Resource: [`arn:aws:s3:::${TOOLS_BUCKET}`, `arn:aws:s3:::${TOOLS_BUCKET}/pg_lies/*`],
          },
        ],
      }),
    },
  ],
});

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
        Condition: ghaOidc.url.apply((url) => ({
          StringEquals: {
            [`${url}:aud`]: AWS_STS,
          },
          StringLike: {
            [`${url}:sub`]: [
              'repo:beyondessential/ops:ref:refs/heads/main',
            ],
          },
        })),
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
              TOOLS_BUCKET,
              'bes-tamanu-release-clients',
              'bes-tamanu-release-servers',
            ].flatMap((bucket) => [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`]),
          },
        ],
      }),
    },
  ],
});

import { all, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { ghaOidc } from '../../common/coreRef.js';
import { AWS_STS, AWS_S3_WRITE_ACTIONS } from '../../constants/external.js';
import { clients, dbDumps, servers, tools } from './buckets.js';

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
              'repo:beyondessential/pg_lies:pull_request',
              'repo:beyondessential/pg_lies:ref:refs/heads/main',
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
            Resource: tools.bucket.bucket.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/pg_lies/*`,
            ]),
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
              'repo:beyondessential/bestool:ref:refs/tags/v*',
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
            Resource: all([
              tools.bucket.bucket,
              clients.bucket.bucket,
              servers.bucket.bucket,
            ]).apply((buckets) =>
              buckets.flatMap((bucket) => [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`]),
            ),
          },
        ],
      }),
    },
  ],
});

new awsClassic.iam.Role('gha-tamanu-test-data-snapshots-s3', {
  name: 'gha-tamanu-test-data-snapshots-s3',
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
            [`${url}:sub`]: ['repo:beyondessential/tamanu:*'],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuTestDataReadWrite',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_WRITE_ACTIONS,
            Resource: dbDumps.bucket.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
        ],
      }),
    },
  ],
});

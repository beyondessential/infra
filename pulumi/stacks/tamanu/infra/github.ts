import { jsonStringify } from '@pulumi/pulumi';
import { Role, PolicyAttachment } from '@pulumi/aws/iam/index.js';
import { AWS_STS } from '../../constants/external.ts';
import { ghaOidc } from '../../common/coreRef.ts';

// deprecated
new Role('github-actions-desktop-s3', {
  name: 'gha-desktop-s3',
  assumeRolePolicy: {
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
            [`${url}:sub`]: [
              // Ops scripts
              'repo:beyondessential/ops:ref:refs/heads/main',

              // Tamanu builds
              'repo:beyondessential/tamanu:pull_request',
              'repo:beyondessential/tamanu:ref:refs/heads/main',
              'repo:beyondessential/tamanu:ref:refs/heads/release/*',
              'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',
            ],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuDesktopClientS3',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
            Resource: [
              'arn:aws:s3:::bes-tamanu-dev-desktop-clients',
              'arn:aws:s3:::bes-tamanu-dev-desktop-clients/*',
              'arn:aws:s3:::bes-tamanu-release-clients',
              'arn:aws:s3:::bes-tamanu-release-clients/*',
            ],
          },
        ],
      }),
    },
  ],
});

new Role('github-actions-server-s3', {
  name: 'gha-server-s3',
  assumeRolePolicy: {
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
            [`${url}:sub`]: [
              // Tamanu builds
              'repo:beyondessential/tamanu:pull_request',
              'repo:beyondessential/tamanu:ref:refs/heads/main',
              'repo:beyondessential/tamanu:ref:refs/heads/release/*',
              'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',
            ],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuServerBuildsS3',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
            Resource: [
              'arn:aws:s3:::bes-tamanu-release-servers',
              'arn:aws:s3:::bes-tamanu-release-servers/*',
            ],
          },
        ],
      }),
    },
  ],
});

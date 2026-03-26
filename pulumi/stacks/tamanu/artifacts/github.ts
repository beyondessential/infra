import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { ghaOidc } from '../../common/coreRef.ts';
import { AWS_STS, AWS_S3_DELETE_ACTIONS, AWS_S3_WRITE_ACTIONS } from '../../constants/external.ts';
import { dbDumps, tools, translations } from './buckets.ts';

new awsClassic.iam.Role('gha-tamanu-test-data-snapshots-s3', {
  name: 'gha-tamanu-test-data-snapshots-s3',
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

new awsClassic.iam.Role('gha-tamanu-translations-upload', {
  name: 'gha-tamanu-translations-upload',
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
            [`${url}:sub`]: ['repo:beyondessential/tamanu:*'],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuTranslationsReadWrite',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_WRITE_ACTIONS,
            Resource: translations.bucket.bucket.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
        ],
      }),
    },
  ],
});

new awsClassic.iam.Role('gha-tamanu-tools-upload', {
  name: 'gha-tamanu-tools-upload',
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
              'repo:beyondessential/bestool:ref:refs/tags/v*.*.*',
              'repo:beyondessential/linux-images:ref:refs/tags/v*.*.*',
              'repo:beyondessential/third-party-builds:ref:refs/heads/main',
            ],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuToolsReadWrite',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_DELETE_ACTIONS,
            Resource: tools.bucket.bucket.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
          {
            Effect: 'Allow',
            Action: ['cloudfront:CreateInvalidation'],
            Resource: [tools.distribution.arn],
          },
        ],
      }),
    },
  ],
});

new awsClassic.iam.Role('gha-linux-images-upload', {
  name: 'gha-linux-images-upload',
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
            [`${url}:sub`]: ['repo:beyondessential/linux-images:ref:refs/tags/v*.*.*'],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuToolsReadWrite',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_DELETE_ACTIONS,
            Resource: tools.bucket.bucket.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
          {
            Effect: 'Allow',
            Action: ['cloudfront:CreateInvalidation'],
            Resource: [tools.distribution.arn],
          },
        ],
      }),
    },
    {
      name: 'LinuxImagesAmiUpload',
      policy: tools.bucket.bucket.apply((bucket) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 's3:DeleteObject',
              Resource: `arn:aws:s3:::${bucket}/linux-images/*`,
            },
            {
              Effect: 'Allow',
              Action: [
                'ec2:DescribeImages',
                'ec2:ImportSnapshot',
                'ec2:DescribeImportSnapshotTasks',
                'ec2:RegisterImage',
                'ec2:CreateTags',
              ],
              Resource: '*',
            },
          ],
        }),
      ),
    },
  ],
});

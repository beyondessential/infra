import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { AWS_STS, AWS_S3_DELETE_ACTIONS } from '../../constants/external.ts';
import { oidcProvider } from './oidc.ts';
import { staging } from './bucket.ts';
import { ghaClaims, tags } from './config.ts';

// Snapshot import, AMI registration, and the attribute changes that make the
// snapshot and image publicly shareable.
const EC2_PUBLISH_ACTIONS = [
  'ec2:ImportSnapshot',
  'ec2:DescribeImportSnapshotTasks',
  'ec2:DescribeSnapshots',
  'ec2:RegisterImage',
  'ec2:DescribeImages',
  'ec2:CreateTags',
  'ec2:ModifyImageAttribute',
  'ec2:ModifySnapshotAttribute',
];

export const role = new awsClassic.iam.Role('gha-linux-images-upload', {
  name: 'gha-linux-images-upload',
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: oidcProvider.arn,
        },
        Condition: oidcProvider.url.apply((url) => ({
          StringEquals: {
            [`${url}:aud`]: AWS_STS,
          },
          StringLike: {
            [`${url}:sub`]: ghaClaims,
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'LinuxImagesAmiPublish',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: EC2_PUBLISH_ACTIONS,
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: AWS_S3_DELETE_ACTIONS,
            Resource: [
              interpolate`arn:aws:s3:::${staging.bucket}`,
              interpolate`arn:aws:s3:::${staging.bucket}/*`,
            ],
          },
        ],
      }),
    },
  ],
  tags,
});

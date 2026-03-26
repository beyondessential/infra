import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { AWS_S3_READ_ACTIONS } from '../../constants/external.ts';
import { tools } from './buckets.ts';

new awsClassic.iam.Role('vmimport', {
  name: 'vmimport',
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Principal: {
          Service: 'vmie.amazonaws.com',
        },
        Condition: {
          StringEquals: {
            'sts:Externalid': 'vmimport',
          },
        },
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'VmImport',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_READ_ACTIONS,
            Resource: tools.bucket.bucket.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
          {
            Effect: 'Allow',
            Action: [
              'ec2:ModifySnapshotAttribute',
              'ec2:CopySnapshot',
              'ec2:RegisterImage',
              'ec2:Describe*',
            ],
            Resource: '*',
          },
        ],
      }),
    },
  ],
});

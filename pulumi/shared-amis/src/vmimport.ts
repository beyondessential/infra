import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { AWS_S3_READ_ACTIONS } from '../../constants/external.ts';
import { staging } from './bucket.ts';
import { tags } from './config.ts';

// VM Import/Export service role assumed by ec2:ImportSnapshot. The name must be
// exactly `vmimport` (the default ImportSnapshot looks up) and the trust policy
// must carry the `sts:Externalid: vmimport` condition per AWS docs.
// https://docs.aws.amazon.com/vm-import/latest/userguide/required-permissions.html
export const vmimport = new awsClassic.iam.Role('vmimport', {
  name: 'vmimport',
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: {
          Service: 'vmie.amazonaws.com',
        },
        Action: 'sts:AssumeRole',
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
      name: 'VmImportExport',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_READ_ACTIONS,
            Resource: [
              interpolate`arn:aws:s3:::${staging.bucket}`,
              interpolate`arn:aws:s3:::${staging.bucket}/*`,
            ],
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
  tags,
});

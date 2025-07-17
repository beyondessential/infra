import * as aws from '@pulumi/aws';
import { BUCKET, externalAccountsRead, externalAccountsWrite } from './config.ts';
import { jsonStringify } from '@pulumi/pulumi';
import { AWS_S3_DELETE_ACTIONS, AWS_S3_READ_ACTIONS } from '../../constants/external.ts';
import { compact } from 'lodash-es';

export const bucket = new aws.s3.BucketV2(
  'bucket',
  {
    bucket: BUCKET,
  },
  { protect: true },
);

const bucketOwnership = new aws.s3.BucketOwnershipControls(
  'bucket-ownership',
  {
    bucket: bucket.id,
    rule: {
      objectOwnership: 'BucketOwnerPreferred',
    },
  },
  { parent: bucket },
);

new aws.s3.BucketAclV2(
  'bucket-acl',
  {
    bucket: bucket.id,
    acl: 'private',
  },
  { parent: bucket, dependsOn: [bucketOwnership] },
);

if (externalAccountsRead.length > 0 || externalAccountsWrite.length > 0) {
  new aws.s3.BucketPolicy(
    'bucket-external-access',
    {
      bucket: bucket.bucket,
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: compact([
          externalAccountsRead.length > 0 && {
            Effect: 'Allow',
            Principal: {
              AWS: externalAccountsRead.map((account) => `arn:aws:iam::${account}:root`),
            },
            Action: [...AWS_S3_READ_ACTIONS, 's3:GetLifecycleConfiguration'],
            Resource: bucket.bucket.apply((name) => [
              `arn:aws:s3:::${name}`,
              `arn:aws:s3:::${name}/*`,
            ]),
          },
          externalAccountsWrite.length > 0 && {
            Effect: 'Allow',
            Principal: {
              AWS: externalAccountsWrite.map((account) => `arn:aws:iam::${account}:root`),
            },
            Action: [...AWS_S3_DELETE_ACTIONS, 's3:GetLifecycleConfiguration'],
            Resource: bucket.bucket.apply((name) => [
              `arn:aws:s3:::${name}`,
              `arn:aws:s3:::${name}/*`,
            ]),
          },
        ]),
      }),
    },
    { parent: bucket },
  );
}

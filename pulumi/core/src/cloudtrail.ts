import * as awsClassic from '@pulumi/aws';
import { getStack, interpolate, jsonStringify } from '@pulumi/pulumi';
import { tags as configTags, trailBucket } from './config.ts';
import { accountId } from '../../common/awsAccount.ts';

const tags = {
  ...configTags,
  Name: trailBucket,
  Purpose: 'audit-logging',
};

const bucket = new awsClassic.s3.Bucket('cloudtrail-bucket', {
  bucket: trailBucket,
  tags,
});

new awsClassic.s3.BucketPublicAccessBlock('cloudtrail-bucket-public-access-block', {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

new awsClassic.s3.BucketVersioning('cloudtrail-bucket-versioning', {
  bucket: bucket.id,
  versioningConfiguration: {
    status: 'Enabled',
  },
});

new awsClassic.s3.BucketLifecycleConfiguration('cloudtrail-bucket-lifecycle', {
  bucket: bucket.id,
  rules: [
    {
      id: 'expire-old-logs',
      status: 'Enabled',
      expiration: {
        days: 365,
      },
      noncurrentVersionExpiration: {
        noncurrentDays: 90,
      },
    },
  ],
});

const bucketPolicy = new awsClassic.s3.BucketPolicy('cloudtrail-bucket-policy', {
  bucket: bucket.id,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AWSCloudTrailAclCheck',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudtrail.amazonaws.com',
        },
        Action: 's3:GetBucketAcl',
        Resource: bucket.arn,
      },
      {
        Sid: 'AWSCloudTrailWrite',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudtrail.amazonaws.com',
        },
        Action: 's3:PutObject',
        Resource: interpolate`${bucket.arn}/AWSLogs/${accountId}/*`,
        Condition: {
          StringEquals: {
            's3:x-amz-acl': 'bucket-owner-full-control',
          },
        },
      },
    ],
  }),
});

export const trail = new awsClassic.cloudtrail.Trail(
  'cloudtrail',
  {
    s3BucketName: bucket.id,
    enableLogFileValidation: true,
    includeGlobalServiceEvents: true,
    isMultiRegionTrail: true,
    tags,
  },
  {
    dependsOn: [bucketPolicy],
  },
);

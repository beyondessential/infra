import { Config, getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { AWS_EC2, AWS_S3_BACKUP_ACTIONS } from '../constants/external.ts';

import { failIfIncorrectAccount } from '../common/coreRef.ts';
import { nativeTags } from '../common/tags.ts';
failIfIncorrectAccount();

const config = new Config();
export const bucketName: string = config.get('bucketName') ?? `bes-kopia-backups-${getStack()}`;

const tags = {
  Purpose: 'backups',
  ...((config.getObject('tags') as object) ?? {}),
};

const bucket = new awsNative.s3.Bucket(
  'backups-bucket',
  {
    bucketName,
    objectLockEnabled: true,
    tags: nativeTags(tags),
    versioningConfiguration: {
      status: 'Enabled',
    },
    objectLockConfiguration: {
      objectLockEnabled: 'Enabled',
      rule: {
        defaultRetention: {
          mode: 'GOVERNANCE',
          days: 30,
        },
      },
    },
  },
  { protect: true },
);

new awsClassic.s3.BucketPolicy('backups-bucket-policy', {
  bucket: bucket.bucketName,
  policy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DenyInsecureTransport',
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: bucket.bucketName.apply((name) => [
          `arn:aws:s3:::${name}`,
          `arn:aws:s3:::${name}/*`,
        ]),
        Condition: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      },
    ],
  }),
});

const fullAccessPolicy = new awsNative.iam.ManagedPolicy('backups-fullaccess-policy', {
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:*'],
        Resource: bucket.bucketName.apply((bucket) => [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`,
        ]),
      },
    ],
  }),
});

const fullAccessRole = new awsNative.iam.Role('backups-fullaccess-role', {
  managedPolicyArns: [fullAccessPolicy.policyArn],
  assumeRolePolicyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Principal: {
          Service: AWS_EC2,
        },
      },
    ],
  }),
});
export const roleForFullAccess = fullAccessRole.roleName;

const kopiaPolicy = new awsNative.iam.ManagedPolicy('backups-kopia-policy', {
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: AWS_S3_BACKUP_ACTIONS,
        Resource: bucket.bucketName.apply((bucket) => [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/*`,
        ]),
      },
    ],
  }),
});

const kopiaRole = new awsNative.iam.Role(`backups-kopia-role`, {
  managedPolicyArns: [kopiaPolicy.policyArn],
  assumeRolePolicyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRole',
        Principal: {
          Service: AWS_EC2,
        },
      },
    ],
  }),
});
export const roleForKopia = kopiaRole.roleName;

new awsClassic.s3.BucketObjectv2(
  `kopia-storageconfig`,
  {
    bucket: bucket.bucketName.apply((name) => name!),
    key: '.storageconfig',
    content: JSON.stringify(
      {
        blobOptions: [
          { prefix: 'p', storageClass: 'INTELLIGENT_TIERING' },
          { storageClass: 'STANDARD' }, // keep indexes etc in frequent access tier
        ],
      },
      null,
      2,
    ),
    contentType: 'application/json',
    contentEncoding: 'utf-8',
    checksumAlgorithm: 'SHA256',
  },
  {
    ignoreChanges: ['objectLockMode', 'objectLockRetainUntilDate'],
  },
);

export const backupUsers = ((config.getObject('users') as string[]) ?? []).map(
  (name) =>
    new awsNative.iam.User(
      `kopia-backups-${name}`,
      {
        tags: nativeTags(tags),
        managedPolicyArns: [kopiaPolicy.policyArn],
      },
      { parent: bucket },
    ).userName,
);

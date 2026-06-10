import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { all, jsonStringify, type Output } from '@pulumi/pulumi';
import {
  AWS_S3_BACKUP_ACTIONS,
  AWS_S3_READ_ACTIONS,
  AWS_EC2,
} from '../../../../constants/external.ts';
import { CrossStack } from '../../../../common/CrossStack.ts';
import { nativeTags } from '../../../../common/tags.ts';
import { billingTags, cloneOf, instances, normalizedStack } from '../config.ts';

interface KopiaOutputs {
  backupBucket: Output<string>;
  backupReadOnlyUser: Output<string>;
  backupUsers: Output<string[]>;
}

function cloneFromStack(ref: string): KopiaOutputs {
  const source = new CrossStack(ref);
  return {
    backupBucket: source.get<string>('backupBucket'),
    backupReadOnlyUser: source.get<string>('backupReadOnlyUser'),
    backupUsers: source.get<string[]>('backupUsers'),
  };
}

function createOwnBucket(): KopiaOutputs {
  const tags = nativeTags(
    {
      Purpose: 'tamanu-backups',
      Stack: normalizedStack,
      ManagedBy: 'pulumi',
    },
    billingTags,
  );

  const bucket = new awsNative.s3.Bucket(
    `bes-tamanu-kopia-backups-${normalizedStack}`,
    {
      objectLockEnabled: true,
      tags,
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
      // Reclaim space once maintenance deletes blobs: expire noncurrent
      // versions just past the 30-day object-lock window, and drop abandoned
      // multipart uploads. Without this, versioning retains deleted blobs
      // forever even after kopia maintenance compacts the repo.
      lifecycleConfiguration: {
        rules: [
          {
            id: 'expire-noncurrent-and-incomplete',
            status: 'Enabled',
            noncurrentVersionExpiration: {
              noncurrentDays: 35,
            },
            abortIncompleteMultipartUpload: {
              daysAfterInitiation: 7,
            },
          },
        ],
      },
    },
    { protect: true },
  );

  new awsClassic.s3.BucketPolicy(
    'backups-bucket-policy',
    {
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
    },
    { protect: false },
  );

  const kopiaPolicy = new awsNative.iam.ManagedPolicy(
    'backups-kopia-policy',
    {
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_BACKUP_ACTIONS,
            Resource: bucket.bucketName.apply((name) => [
              `arn:aws:s3:::${name}`,
              `arn:aws:s3:::${name}/*`,
            ]),
          },
        ],
      }),
    },
    { parent: bucket, protect: false, ignoreChanges: ['users', 'roles', 'groups'] },
  );

  new awsNative.iam.Role(
    `backups-kopia-role-${normalizedStack}`,
    {
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
      tags,
    },
    { parent: bucket, protect: false },
  );

  new awsClassic.s3.BucketObjectv2(
    'kopia-storageconfig',
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
      parent: bucket,
      protect: false,
      ignoreChanges: ['objectLockMode', 'objectLockRetainUntilDate'],
    },
  );

  const users = instances.map(
    (inst) =>
      new awsNative.iam.User(
        `backups-kopia-${normalizedStack}-${inst.id}`,
        {
          managedPolicyArns: [kopiaPolicy.policyArn],
          tags,
        },
        { parent: bucket, protect: false },
      ).userName,
  );

  const kopiaReadOnlyPolicy = new awsNative.iam.ManagedPolicy(
    'backups-kopia-readonly-policy',
    {
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_READ_ACTIONS,
            Resource: bucket.bucketName.apply((name) => [
              `arn:aws:s3:::${name}`,
              `arn:aws:s3:::${name}/*`,
            ]),
          },
        ],
      }),
    },
    { parent: bucket, protect: false, ignoreChanges: ['users', 'roles', 'groups'] },
  );

  const readOnlyUser = new awsNative.iam.User(
    `backups-kopia-${normalizedStack}-readonly`,
    {
      managedPolicyArns: [kopiaReadOnlyPolicy.policyArn],
      tags,
    },
    { parent: bucket, protect: false },
  ).userName;

  return {
    backupBucket: bucket.bucketName.apply((name) => name!),
    backupReadOnlyUser: readOnlyUser,
    backupUsers: all(users),
  };
}

const outputs = cloneOf ? cloneFromStack(cloneOf) : createOwnBucket();

export const backupBucket = outputs.backupBucket;
export const backupReadOnlyUser = outputs.backupReadOnlyUser;
export const backupUsers = outputs.backupUsers;

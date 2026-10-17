import { Config, getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';

import { failIfIncorrectAccount, region } from '../common/coreRef.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { registerBackupConfig } from '../common/canopy/CanopyBackupConfig.ts';
import {
  DEVICE_S3_ACTIONS,
  CLOUDWATCH_METRIC_ACTIONS,
  deviceAssumeRolePolicy,
  maintenanceAssumeRolePolicy,
} from '../common/canopyBackup.ts';
import { nativeTags } from '../common/tags.ts';
failIfIncorrectAccount();

const config = new Config();

// The per-bucket roles trust Canopy's central-account IRSA roles (chained
// AssumeRole) and nothing else, so the Canopy infrastructure stack is required.
const canopy = new CrossStack(config.require('canopyInfra'));
const canopyIssuerRoleArn = canopy.get<string>('canopyIssuerRoleArn');
const canopyJobsRoleArn = canopy.get<string>('canopyJobsRoleArn');
// private-server's wizard probes the bucket by assuming both per-bucket roles.
const canopyPrivateRoleArn = canopy.get<string>('canopyPrivateRoleArn');

// spec: LNXBAK#repository-bucket
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
    // On a versioned + object-locked bucket, kopia "deletes" are delete-markers
    // that reclaim nothing until lifecycle expires the noncurrent versions, so
    // this is load-bearing for normal GC. noncurrentDays ≥ the 30-day lock.
    lifecycleConfiguration: {
      rules: [
        {
          id: 'expire-noncurrent-and-incomplete',
          status: 'Enabled',
          noncurrentVersionExpiration: { noncurrentDays: 35 },
          // kopia deletes are version-less, so each leaves a delete-marker; reap
          // the dangling marker once its last noncurrent version is gone.
          // spec: LNXBAK#repository-bucket
          expiredObjectDeleteMarker: true,
          abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
        },
      ],
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

const fullAccessPolicy = new awsNative.iam.ManagedPolicy(
  'backups-fullaccess-policy',
  {
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
        // s3-metrics assumes this role to read BucketSizeBytes cross-account.
        { Effect: 'Allow', Action: CLOUDWATCH_METRIC_ACTIONS, Resource: '*' },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

const fullAccessRole = new awsNative.iam.Role('backups-fullaccess-role', {
  managedPolicyArns: [fullAccessPolicy.policyArn],
  assumeRolePolicyDocument: maintenanceAssumeRolePolicy(canopyJobsRoleArn, canopyPrivateRoleArn),
});
export const roleForFullAccess = fullAccessRole.roleName;

// The role Canopy issues device creds from: no delete of versions, no retention
// changes (the bucket's default GOVERNANCE retention auto-locks every PUT), plus
// the Object Lock read for the preflight.
// spec: LNXBAK#repository-roles
const devicePolicy = new awsNative.iam.ManagedPolicy(
  'backups-device-policy',
  {
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: DEVICE_S3_ACTIONS,
          Resource: bucket.bucketName.apply((bucket) => [
            `arn:aws:s3:::${bucket}`,
            `arn:aws:s3:::${bucket}/*`,
          ]),
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

const kopiaRole = new awsNative.iam.Role(`backups-kopia-role`, {
  managedPolicyArns: [devicePolicy.policyArn],
  assumeRolePolicyDocument: deviceAssumeRolePolicy(canopyIssuerRoleArn, canopyPrivateRoleArn),
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

// Consumed by Canopy's server_group_backup_config (device → target_role_arn,
// maintenance → the canopy-jobs assume target) and its preflight.
export const deviceRoleArn = kopiaRole.arn;
export const maintenanceRoleArn = fullAccessRole.arn;
export const bucketArn = bucket.arn;

// Register the config with Canopy when a server_group_id is set (the gate).
registerBackupConfig('canopy-backup-config', {
  serverGroupId: config.get('serverGroupId'),
  bucket: bucketName,
  region,
  targetRoleArn: kopiaRole.arn,
  maintenanceRoleArn: fullAccessRole.arn,
});


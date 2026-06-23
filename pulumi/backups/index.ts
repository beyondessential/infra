import { Config, getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { AWS_S3_BACKUP_ACTIONS } from '../constants/external.ts';

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

// Onboarding to Canopy: the per-bucket roles additionally trust Canopy's
// central-account IRSA roles (chained AssumeRole) and the device role drops
// delete/retention. Without the ref the stack stays on the EC2-only path,
// byte-for-byte unchanged.
const canopyInfraRef = config.get('canopyInfra');
const canopy = canopyInfraRef ? new CrossStack(canopyInfraRef) : undefined;
const canopyIssuerRoleArn = canopy?.get<string>('canopyIssuerRoleArn');
const canopyJobsRoleArn = canopy?.get<string>('canopyJobsRoleArn');
// private-server's wizard probes the bucket by assuming both per-bucket roles.
const canopyPrivateRoleArn = canopy?.get<string>('canopyPrivateRoleArn');

// The legacy IAM-User keys / EC2 role trust exist only while a stack is not
// onboarded to Canopy. Once `canopyInfra` is set the device role drops to the
// reduced device policy, the EC2 trust falls away (see canopyBackup.ts), and the
// static-key backup users are no longer provisioned.

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
        ...(canopy ? [{ Effect: 'Allow', Action: CLOUDWATCH_METRIC_ACTIONS, Resource: '*' }] : []),
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

// Full-access (delete) policy for the legacy IAM Users and the EC2-assumed device
// role. Retired once a stack is onboarded to Canopy (the device role moves to the
// reduced devicePolicy and the static-key users are dropped).
const kopiaPolicy = canopy
  ? undefined
  : new awsNative.iam.ManagedPolicy(
      'backups-kopia-policy',
      {
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
      },
      { ignoreChanges: ['users', 'roles', 'groups'] },
    );

// The role Canopy issues device creds from drops delete/retention (the bucket's
// default GOVERNANCE retention auto-locks every PUT) and gains the Object Lock
// read for the preflight. The IAM Users keep the full kopiaPolicy (EC2-direct
// path). Without Canopy the role stays on the full kopiaPolicy, unchanged.
const devicePolicy = canopy
  ? new awsNative.iam.ManagedPolicy(
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
    )
  : undefined;

// Exactly one of devicePolicy (Canopy) / kopiaPolicy (legacy) is defined.
const kopiaRole = new awsNative.iam.Role(`backups-kopia-role`, {
  managedPolicyArns: [(devicePolicy ?? kopiaPolicy)!.policyArn],
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

// Static-key backup users: legacy path only. Dropped once onboarded to Canopy,
// which issues per-device STS creds instead.
export const backupUsers = canopy
  ? []
  : ((config.getObject('users') as string[]) ?? []).map(
      (name) =>
        new awsNative.iam.User(
          `kopia-backups-${name}`,
          {
            tags: nativeTags(tags),
            managedPolicyArns: [kopiaPolicy!.policyArn],
          },
          { parent: bucket },
        ).userName,
    );

import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { jsonStringify, type Output } from '@pulumi/pulumi';
import { CrossStack } from '../../../../common/CrossStack.ts';
import {
  DEVICE_S3_ACTIONS,
  CLOUDWATCH_METRIC_ACTIONS,
  deviceAssumeRolePolicy,
  maintenanceAssumeRolePolicy,
} from '../../../../common/canopyBackup.ts';
import { cfg, region } from '../../../../common/coreRef.ts';
import { CanopyBackupConfig } from '../../../../common/canopy/CanopyBackupConfig.ts';
import { nativeTags } from '../../../../common/tags.ts';
import { billingTags, cloneOf, normalizedStack } from '../config.ts';

// Canopy issues per-device credentials by chained AssumeRole into the device
// role, and maintains the repository through the maintenance role. Both roles
// trust Canopy's IRSA roles only, so the Canopy infrastructure stack is required.
const canopy = new CrossStack(cfg.require('canopyInfra'));
const canopyIssuerRoleArn = canopy.get<string>('canopyIssuerRoleArn');
const canopyJobsRoleArn = canopy.get<string>('canopyJobsRoleArn');
// private-server's wizard probes the bucket by assuming both per-bucket roles.
const canopyPrivateRoleArn = canopy.get<string>('canopyPrivateRoleArn');

interface KopiaOutputs {
  backupBucket: Output<string>;
  deviceRoleArn: Output<string>;
  maintenanceRoleArn: Output<string>;
  bucketArn: Output<string>;
}

// spec: LNXBAK#repository-bucket
function cloneFromStack(ref: string): KopiaOutputs {
  const source = new CrossStack(ref);
  return {
    backupBucket: source.get<string>('backupBucket'),
    deviceRoleArn: source.get<string>('deviceRoleArn'),
    maintenanceRoleArn: source.get<string>('maintenanceRoleArn'),
    bucketArn: source.get<string>('bucketArn'),
  };
}

// spec: LNXBAK#repository-bucket
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
              // spec: LNXBAK#repository-bucket
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
            // spec: LNXBAK#repository-bucket
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

  // The role Canopy issues device creds from: no delete of versions, no
  // retention changes, plus the Object Lock read for the preflight.
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

  const kopiaRole = new awsNative.iam.Role(
    `backups-kopia-role-${normalizedStack}`,
    {
      managedPolicyArns: [devicePolicy.policyArn],
      assumeRolePolicyDocument: deviceAssumeRolePolicy(canopyIssuerRoleArn, canopyPrivateRoleArn),
      tags,
    },
    { parent: bucket, protect: false },
  );

  // Maintenance/fullaccess role: s3:* + CloudWatch for the s3-metrics loop;
  // trusts canopy-jobs and canopy-private (never the issuer).
  // spec: LNXBAK#repository-roles
  const maintenanceRole = new awsNative.iam.Role(
    `backups-fullaccess-role-${normalizedStack}`,
    {
      managedPolicyArns: [
        new awsNative.iam.ManagedPolicy(
          'backups-fullaccess-policy',
          {
            policyDocument: jsonStringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['s3:*'],
                  Resource: bucket.bucketName.apply((name) => [
                    `arn:aws:s3:::${name}`,
                    `arn:aws:s3:::${name}/*`,
                  ]),
                },
                { Effect: 'Allow', Action: CLOUDWATCH_METRIC_ACTIONS, Resource: '*' },
              ],
            }),
          },
          { parent: bucket, protect: false, ignoreChanges: ['users', 'roles', 'groups'] },
        ).policyArn,
      ],
      assumeRolePolicyDocument: maintenanceAssumeRolePolicy(canopyJobsRoleArn, canopyPrivateRoleArn),
      tags,
    },
    { parent: bucket, protect: false },
  );

  new awsClassic.s3.BucketObjectv2(
    // spec: LNXBAK#repository-bucket
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

  // Register the config with Canopy when a server_group_id is set (the gate).
  const serverGroupId = cfg.get('serverGroupId');
  if (serverGroupId) {
    // spec: LNXBAK#canopy-registration
    new CanopyBackupConfig('canopy-backup-config', {
      serverGroupId,
      bucket: bucket.bucketName.apply((name) => name!),
      region,
      targetRoleArn: kopiaRole.arn,
      maintenanceRoleArn: maintenanceRole.arn,
    });
  }

  return {
    backupBucket: bucket.bucketName.apply((name) => name!),
    deviceRoleArn: kopiaRole.arn,
    maintenanceRoleArn: maintenanceRole.arn,
    bucketArn: bucket.arn,
  };
}

const outputs = cloneOf ? cloneFromStack(cloneOf) : createOwnBucket();

export const backupBucket = outputs.backupBucket;
export const deviceRoleArn = outputs.deviceRoleArn;
export const maintenanceRoleArn = outputs.maintenanceRoleArn;
export const bucketArn = outputs.bucketArn;

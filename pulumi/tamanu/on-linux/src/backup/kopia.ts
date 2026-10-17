import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { all, jsonStringify, type Output } from '@pulumi/pulumi';
import { AWS_S3_BACKUP_ACTIONS, AWS_S3_READ_ACTIONS } from '../../../../constants/external.ts';
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
import { billingTags, cloneOf, instances, normalizedStack } from '../config.ts';

// See backups/index.ts: onboarding to Canopy adds chained-assume trust for
// Canopy's IRSA roles, reduces the device role, and adds a maintenance role
// (on-linux has none otherwise). Without the ref, the EC2-only path is unchanged.
const canopyInfraRef = cfg.get('canopyInfra');
const canopy = canopyInfraRef ? new CrossStack(canopyInfraRef) : undefined;
const canopyIssuerRoleArn = canopy?.get<string>('canopyIssuerRoleArn');
const canopyJobsRoleArn = canopy?.get<string>('canopyJobsRoleArn');
// private-server's wizard probes the bucket by assuming both per-bucket roles.
const canopyPrivateRoleArn = canopy?.get<string>('canopyPrivateRoleArn');

// The legacy per-instance IAM-User keys / EC2 role trust exist only while a stack
// is not onboarded to Canopy. Once `canopyInfra` is set the device role drops to
// the reduced device policy, the EC2 trust falls away (see canopyBackup.ts), and
// the static-key writer and read-only users are no longer provisioned.

interface KopiaOutputs {
  backupBucket: Output<string>;
  backupReadOnlyUser: Output<string> | undefined;
  backupUsers: Output<string[]>;
  deviceRoleArn: Output<string>;
  maintenanceRoleArn: Output<string> | undefined;
  bucketArn: Output<string>;
}

// spec: LNXBAK#repository-bucket
function cloneFromStack(ref: string): KopiaOutputs {
  const source = new CrossStack(ref);
  return {
    backupBucket: source.get<string>('backupBucket'),
    backupReadOnlyUser: source.get<string>('backupReadOnlyUser'),
    backupUsers: source.get<string[]>('backupUsers'),
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

  // Full-access (delete) policy for the legacy per-instance IAM Users and the
  // EC2-assumed device role. Retired once a stack is onboarded to Canopy.
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

  // The role Canopy issues device creds from drops delete/retention and gains
  // the Object Lock read; the IAM Users keep the full kopiaPolicy. Without
  // Canopy the role stays on the full kopiaPolicy, unchanged.
  // spec: LNXBAK#repository-roles
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
                Resource: bucket.bucketName.apply((name) => [
                  `arn:aws:s3:::${name}`,
                  `arn:aws:s3:::${name}/*`,
                ]),
              },
            ],
          }),
        },
        { parent: bucket, protect: false, ignoreChanges: ['users', 'roles', 'groups'] },
      )
    : undefined;

  const kopiaRole = new awsNative.iam.Role(
    `backups-kopia-role-${normalizedStack}`,
    {
      // Exactly one of devicePolicy (Canopy) / kopiaPolicy (legacy) is defined.
      managedPolicyArns: [(devicePolicy ?? kopiaPolicy)!.policyArn],
      assumeRolePolicyDocument: deviceAssumeRolePolicy(canopyIssuerRoleArn, canopyPrivateRoleArn),
      tags,
    },
    { parent: bucket, protect: false },
  );

  // Maintenance/fullaccess role: only when onboarded to Canopy (the EC2 model
  // never had one). s3:* + CloudWatch for the s3-metrics loop; trusts canopy-jobs
  // (never the issuer).
  // spec: LNXBAK#repository-roles
  const maintenanceRole = canopy
    ? new awsNative.iam.Role(
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
          assumeRolePolicyDocument: maintenanceAssumeRolePolicy(
            canopyJobsRoleArn,
            canopyPrivateRoleArn,
          ),
          tags,
        },
        { parent: bucket, protect: false },
      )
    : undefined;

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

  // Per-instance writer users (static keys): legacy path only. Canopy issues
  // per-device STS creds instead.
  const users = canopy
    ? []
    : instances.map(
        (inst) =>
          new awsNative.iam.User(
            `backups-kopia-${normalizedStack}-${inst.id}`,
            {
              managedPolicyArns: [kopiaPolicy!.policyArn],
              tags,
            },
            { parent: bucket, protect: false },
          ).userName,
      );

  // Read-only restore/inspection user (static keys): legacy path only, dropped
  // once onboarded to Canopy.
  let readOnlyUser: Output<string> | undefined;
  if (!canopy) {
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

    readOnlyUser = new awsNative.iam.User(
      `backups-kopia-${normalizedStack}-readonly`,
      {
        managedPolicyArns: [kopiaReadOnlyPolicy.policyArn],
        tags,
      },
      { parent: bucket, protect: false },
    ).userName;
  }

  // Register the config with Canopy when a server_group_id is set (the gate).
  // Requires Canopy onboarding (the maintenance role only exists then).
  const serverGroupId = cfg.get('serverGroupId');
  if (serverGroupId) {
    if (!maintenanceRole) {
      throw new Error(
        'on-linux backups: serverGroupId requires Canopy onboarding (set canopyInfra)',
      );
    }
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
    backupReadOnlyUser: readOnlyUser,
    backupUsers: all(users),
    deviceRoleArn: kopiaRole.arn,
    maintenanceRoleArn: maintenanceRole?.arn,
    bucketArn: bucket.arn,
  };
}

const outputs = cloneOf ? cloneFromStack(cloneOf) : createOwnBucket();

export const backupBucket = outputs.backupBucket;
export const backupReadOnlyUser = outputs.backupReadOnlyUser;
export const backupUsers = outputs.backupUsers;
export const deviceRoleArn = outputs.deviceRoleArn;
export const maintenanceRoleArn = outputs.maintenanceRoleArn;
export const bucketArn = outputs.bucketArn;

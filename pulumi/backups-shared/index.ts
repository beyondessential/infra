import { Config, jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';

import { failIfIncorrectAccount, region } from '../common/coreRef.ts';
import { CrossStack } from '../common/CrossStack.ts';
import {
  DEVICE_S3_ACTIONS,
  CLOUDWATCH_METRIC_ACTIONS,
  deviceAssumeRolePolicy,
  maintenanceAssumeRolePolicy,
} from '../common/canopyBackup.ts';
import { nativeTags } from '../common/tags.ts';

failIfIncorrectAccount();

const config = new Config();

// The shared backups account: Canopy provisions one auto-named bucket per group
// in here, for deployments with no BYO AWS account. This stack only stands up
// the cross-account roles — Canopy creates the buckets, applies the security
// recipe, and registers each group's config itself at onboarding.

// Canopy's central-account IRSA identities (chained AssumeRole into this account).
const canopy = new CrossStack(config.require('canopyInfra'));
const canopyIssuerRoleArn = canopy.get<string>('canopyIssuerRoleArn');
const canopyJobsRoleArn = canopy.get<string>('canopyJobsRoleArn');
const canopyPrivateRoleArn = canopy.get<string>('canopyPrivateRoleArn');

// Every bucket Canopy provisions here is named `bes-canopy-backup-<...>`; scoping
// the roles to this pattern means they can only ever touch Canopy buckets.
const bucketArns = ['arn:aws:s3:::bes-canopy-backup-*', 'arn:aws:s3:::bes-canopy-backup-*/*'];

const tags = {
  Purpose: 'backups',
  ...((config.getObject('tags') as object) ?? {}),
};

// 1. Provisioner role — create the bucket + apply the security recipe + reconcile
// billing tags. No data-plane (no read/delete of backup objects). Trusted by the
// backups pod (canopy-jobs) only.
const provisionerPolicy = new awsNative.iam.ManagedPolicy(
  'backups-shared-provisioner-policy',
  {
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            's3:CreateBucket',
            's3:PutBucketVersioning',
            's3:PutBucketObjectLockConfiguration',
            's3:PutLifecycleConfiguration',
            's3:GetBucketTagging',
            's3:PutBucketTagging',
            's3:PutBucketPublicAccessBlock',
            's3:PutBucketPolicy',
          ],
          Resource: 'arn:aws:s3:::bes-canopy-backup-*',
        },
        {
          // Seed the initial `.storageconfig` object only.
          Effect: 'Allow',
          Action: 's3:PutObject',
          Resource: 'arn:aws:s3:::bes-canopy-backup-*/*',
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

const provisionerRole = new awsNative.iam.Role('backups-shared-provisioner-role', {
  managedPolicyArns: [provisionerPolicy.policyArn],
  assumeRolePolicyDocument: maintenanceAssumeRolePolicy(canopyJobsRoleArn),
  tags: nativeTags(tags),
});

// 2. Shared device role — write-without-delete kopia creds for remote devices.
// Trusted by canopy-issuer (mints device creds) + canopy-private (wizard probe).
// MUST NOT grant DeleteObject / PutObjectRetention: the device-compromise defense
// relies on the device being unable to delete or shorten locks; retention is
// applied server-side by each bucket's default GOVERNANCE rule. Canopy further
// scopes every issued credential to a single bucket via an STS session policy.
const devicePolicy = new awsNative.iam.ManagedPolicy(
  'backups-shared-device-policy',
  {
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [{ Effect: 'Allow', Action: DEVICE_S3_ACTIONS, Resource: bucketArns }],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

const deviceRole = new awsNative.iam.Role('backups-shared-device-role', {
  managedPolicyArns: [devicePolicy.policyArn],
  assumeRolePolicyDocument: deviceAssumeRolePolicy(canopyIssuerRoleArn, canopyPrivateRoleArn),
  tags: nativeTags(tags),
});

// 3. Shared maintenance role — full data-plane (kopia maintenance reclaims via
// lifecycle on a versioned bucket, hence DeleteObject) + CloudWatch read for
// bucket metrics. Trusted by the backups pod (canopy-jobs) + canopy-private.
const maintenancePolicy = new awsNative.iam.ManagedPolicy(
  'backups-shared-maintenance-policy',
  {
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: 's3:*', Resource: bucketArns },
        { Effect: 'Allow', Action: CLOUDWATCH_METRIC_ACTIONS, Resource: '*' },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

const maintenanceRole = new awsNative.iam.Role('backups-shared-maintenance-role', {
  managedPolicyArns: [maintenancePolicy.policyArn],
  assumeRolePolicyDocument: maintenanceAssumeRolePolicy(canopyJobsRoleArn, canopyPrivateRoleArn),
  tags: nativeTags(tags),
});

// Consumed by the Canopy deploy → env vars on the backups pod / public-server.
export const provisionerRoleArn = provisionerRole.arn;
export const deviceRoleArn = deviceRole.arn;
export const maintenanceRoleArn = maintenanceRole.arn;
export const backupRegion = region;

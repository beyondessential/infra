import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';

import { cfg } from '../common/cfg.ts';
import { accountId, region } from '../common/awsAccount.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { nativeTags } from '../common/tags.ts';

// The Shared AMIs account has no `core` stack, so guard on the configured id
// rather than the usual failIfIncorrectAccountOrRegion() pattern.
const expectedAccountId = cfg.require('expectedAccountId');
accountId.apply((id) => {
  if (id !== expectedAccountId) {
    throw new Error(`Incorrect account: expected ${expectedAccountId} but got ${id}`);
  }
});

const retentionDays = cfg.getNumber('retentionDays') ?? 90;

// canopy-jobs (central account) chain-assumes the writer role to push the vault
// blob. Read cross-account from the canopy-infra stack's exports.
const canopyJobsRoleArn = new CrossStack(cfg.require('canopy-infra')).get<string>(
  'canopyJobsRoleArn',
);

const tags = { Purpose: 'canopy-recovery-vault' };

// COMPLIANCE Object Lock + versioning: each daily snapshot is a new immutable
// version of the same key; a Canopy compromise cannot delete or alter history.
// Lifecycle expires noncurrent versions just past the lock so it can't grow
// forever. The blob is age-encrypted; SSE-S3 is defence in depth.
const bucket = new awsNative.s3.Bucket(
  'canopy-recovery-vault',
  {
    objectLockEnabled: true,
    tags: nativeTags(tags),
    versioningConfiguration: { status: 'Enabled' },
    objectLockConfiguration: {
      objectLockEnabled: 'Enabled',
      rule: { defaultRetention: { mode: 'COMPLIANCE', days: retentionDays } },
    },
    bucketEncryption: {
      serverSideEncryptionConfiguration: [
        { serverSideEncryptionByDefault: { sseAlgorithm: 'AES256' } },
      ],
    },
    lifecycleConfiguration: {
      rules: [
        {
          id: 'expire-noncurrent',
          status: 'Enabled',
          noncurrentVersionExpiration: { noncurrentDays: retentionDays + 5 },
        },
      ],
    },
  },
  { protect: true },
);

new awsClassic.s3.BucketPolicy('canopy-recovery-vault-policy', {
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
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
    ],
  }),
});

// Write-only: PutObject and nothing else. Canopy never reads the vault back (and
// couldn't — the blob is asymmetrically encrypted), and must not be able to
// delete it. Default COMPLIANCE retention auto-locks every PUT, so no retention
// action is needed.
const writerPolicy = new awsNative.iam.ManagedPolicy(
  'canopy-recovery-vault-writer-policy',
  {
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:PutObject'],
          Resource: bucket.bucketName.apply((name) => `arn:aws:s3:::${name}/*`),
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

const writerRole = new awsNative.iam.Role('canopy-recovery-vault-writer', {
  managedPolicyArns: [writerPolicy.policyArn],
  assumeRolePolicyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: canopyJobsRoleArn } },
    ],
  }),
});

export const vaultBucket = bucket.bucketName;
export const vaultRoleArn = writerRole.arn;
export const vaultRegion = region;

import { Config, getStack, jsonStringify, Output } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { AWS_EC2, AWS_S3_BACKUP_ACTIONS } from '../constants/external.js';

import { failIfIncorrectAccount } from '../common/coreRef.js';
failIfIncorrectAccount();

const config = new Config();
const products: string[] = config.getObject('buckets') ?? ['tamanu'];

interface Export {
  name: string;
  fullAccessRole: Output<string>;
  kopiaRole: Output<string>;
}

const exports: { [string]: Export } = {};
for (const product of products) {
  const exp: Partial<Export> = {};

  const prefix = product === 'tamanu' ? '' : `${product}-`;

  const BUCKET_NAME = `bes-${product}-${getStack()}-backups`;
  exp.name = BUCKET_NAME;

  const tags = {
    Purpose: 'backups',
    Product: product,
  };

  const bucket = new awsClassic.s3.BucketV2(
    `${prefix}backups-bucket`,
    {
      bucket: BUCKET_NAME,
      objectLockEnabled: true,
      tags,
    },
    { protect: true },
  );

  new awsClassic.s3.BucketVersioningV2(
    `${prefix}backups-versions`,
    {
      bucket: bucket.id,
      versioningConfiguration: {
        status: 'Enabled',
        // mfaDelete: 'Enabled',
      },
    },
    { protect: true },
  );

  new awsClassic.s3.BucketObjectLockConfigurationV2(
    `${prefix}backups-locks`,
    {
      bucket: bucket.id,
      rule: {
        defaultRetention: {
          mode: 'COMPLIANCE',
          days: 30,
        },
      },
    },
    {
      protect: true,
    },
  );

  const fullAccessPolicy = new awsClassic.iam.Policy(
    `${prefix}backups-fullaccess-policy`,
    {
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:*'],
            Resource: [BUCKET_NAME].flatMap((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
        ],
      }),
    },
    { dependsOn: [bucket] },
  );

  const fullAccessRole = new awsClassic.iam.Role(`${prefix}backups-fullaccess-role`, {
    assumeRolePolicy: {
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
    },
    managedPolicyArns: [fullAccessPolicy.arn],
  });
  exp.fullAccessRole = fullAccessRole.name;

  const kopiaPolicy = new awsClassic.iam.Policy(
    `${prefix}backups-kopia-policy`,
    {
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_BACKUP_ACTIONS,
            Resource: [BUCKET_NAME].flatMap((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/kopia/*`,
            ]),
          },
        ],
      }),
    },
    { dependsOn: [bucket] },
  );

  const kopiaRole = new awsClassic.iam.Role(`${prefix}backups-kopia-role`, {
    assumeRolePolicy: {
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
    },
    managedPolicyArns: [kopiaPolicy.arn],
  });
  exp.kopiaRole = kopiaRole.name;

  new awsClassic.iam.InstanceProfile(`${prefix}ec2-backups-instance`, {
    name: `EC2InstanceProfileFor${product.charAt(0).toUpperCase() + product.slice(1)}BackupsPush`,
    role: kopiaRole.name,
  });

  // Legacy: create individual machine users for individual servers instead
  if (config.getBoolean('externalAccessUser')) {
    const user = new awsClassic.iam.User(`${prefix}backups-user`, {
      name: 'tamanu-backups',
      tags,
    });

    new awsClassic.iam.UserPolicyAttachment(`${prefix}backups-user`, {
      user: user.name,
      policyArn: kopiaRole.arn,
    });
  }

  exports[product] = exp as Export;
}

export const buckets = exports;

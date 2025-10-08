import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { getStack, jsonStringify } from '@pulumi/pulumi';
import { AWS_S3_BACKUP_ACTIONS, AWS_EC2 } from '../../../constants/external.ts';
import { instances } from '../config.ts';

const tags = [
  {
    key: 'Purpose',
    value: 'backups',
  },
];

const bucket = new awsNative.s3.Bucket(
  `bes-tamanu-kopia-backups-${getStack()}`,
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
  },
  { protect: true },
);
export const backupBucket = bucket.bucketName;

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
  { parent: bucket },
);

const kopiaRole = new awsNative.iam.Role(
  'backups-kopia-role',
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
  },
  { parent: bucket },
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
    ignoreChanges: ['objectLockMode', 'objectLockRetainUntilDate'],
  },
);

export const backupUsers = instances.map(
  (inst) =>
    new awsNative.iam.User(
      `tamanu-kopia-backups-${inst.id}`,
      {
        tags,
        managedPolicyArns: [kopiaPolicy.policyArn],
      },
      { parent: bucket },
    ).userName,
);

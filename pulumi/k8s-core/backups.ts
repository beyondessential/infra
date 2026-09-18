import * as awsClassic from '@pulumi/aws';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { clusterName, oidcProvider, tags } from './cluster.ts';
import { stackName } from '../common/coreRef.ts';
import { interpolate } from '@pulumi/pulumi';
import { AWS_S3_DELETE_ACTIONS } from '../constants/external.ts';

export const bucket = new awsClassic.s3.BucketV2('s3-backups', {
  bucket: `bes-k8s-${stackName}-backups`,
  tags: {
    Purpose: 'k8s-backups',
    ...tags,
  },
});

// TODO: intelligent tiering

// Barman expires backups past the recovery window itself, so the role holds
// s3:DeleteObject. Versioning keeps that from being destructive: a delete is a
// marker over a retained version, and the role has no s3:DeleteObjectVersion.
new awsClassic.s3.BucketVersioning('s3-backups-versioning', {
  bucket: bucket.id,
  versioningConfiguration: {
    status: 'Enabled',
  },
});

new awsClassic.s3.BucketLifecycleConfiguration('s3-backups-lifecycle', {
  bucket: bucket.id,
  rules: [
    {
      id: 'expire-noncurrent',
      status: 'Enabled',
      noncurrentVersionExpiration: {
        noncurrentDays: 30,
      },
    },
  ],
});

const policy = new awsClassic.iam.Policy(
  's3-backups-policy',
  {
    namePrefix: 'EKSS3Backups-',
    description: interpolate`Policy for S3 Backups bucket (cluster: ${clusterName})`,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: AWS_S3_DELETE_ACTIONS,
          Resource: [
            interpolate`arn:aws:s3:::${bucket.bucket}`,
            interpolate`arn:aws:s3:::${bucket.bucket}/*`,
          ],
        },
      ],
    },
  },
  { parent: bucket },
);

export const role = eksServiceAccount(
  's3-backups-role',
  {
    roleName: 'EKSS3Backups-',
    roleDescription: interpolate`Service account for S3 Backups bucket (cluster: ${clusterName})`,
    serviceAccountName: 's3-backups',
    oidcProviderArn: oidcProvider.arn,
    namespace: '*',
    managedPolicyArns: [policy.arn],
  },
  { parent: bucket },
);

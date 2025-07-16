import * as k8s from '@pulumi/kubernetes';
import * as awsClassic from '@pulumi/aws';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { clusterName, oidcProvider, tags } from './cluster.ts';
import { provider } from './kubeconfig.ts';
import { stackName } from '../common/coreRef.ts';
import { interpolate } from '@pulumi/pulumi';
import { AWS_S3_MULTIPART_ACTIONS } from '../constants/external.ts';

export const bucket = new awsClassic.s3.BucketV2('s3-backups', {
  bucket: `bes-k8s-${stackName}-backups`,
  tags: {
    Purpose: 'k8s-backups',
    ...tags,
  },
});

// TODO: intelligent tiering

const bucketOwnership = new awsClassic.s3.BucketOwnershipControls(
  's3-backups-ownership',
  {
    bucket: bucket.id,
    rule: {
      objectOwnership: 'BucketOwnerPreferred',
    },
  },
  { parent: bucket },
);

new awsClassic.s3.BucketAclV2(
  's3-backups-acl',
  {
    bucket: bucket.id,
    acl: 'private',
  },
  { parent: bucket, dependsOn: [bucketOwnership] },
);

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
          Action: AWS_S3_MULTIPART_ACTIONS,
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

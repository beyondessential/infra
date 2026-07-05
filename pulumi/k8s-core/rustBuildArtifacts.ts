import * as awsClassic from '@pulumi/aws';
import { interpolate } from '@pulumi/pulumi';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { clusterName, oidcProvider, tags } from './cluster.ts';
import { stackName } from '../common/coreRef.ts';
import { AWS_S3_MULTIPART_ACTIONS } from '../constants/external.ts';

// Out-of-band artifact transfer for the out-of-tree `rust-build` stack
// (pulumi/rust-build/). The k8s exec channel drops the tail of large streams, so
// builders upload artifacts here and the client downloads a presigned URL
// directly (fast + reliable, no client AWS creds). Objects are transient — a
// lifecycle rule expires them after a day. Access is scoped to the `rust-build`
// service account via IRSA. See docs/plans/rust-remote-build.md.
export const rustBuildBucket = new awsClassic.s3.BucketV2('s3-rust-build', {
  bucket: `bes-k8s-${stackName}-rust-build`,
  tags: {
    Purpose: 'k8s-rust-build-artifacts',
    ...tags,
  },
});

new awsClassic.s3.BucketLifecycleConfigurationV2(
  's3-rust-build-lifecycle',
  {
    bucket: rustBuildBucket.id,
    rules: [
      {
        id: 'expire-artifacts',
        status: 'Enabled',
        filter: {},
        expiration: { days: 1 },
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
      },
    ],
  },
  { parent: rustBuildBucket },
);

const policy = new awsClassic.iam.Policy(
  's3-rust-build-policy',
  {
    namePrefix: 'EKSRustBuild-',
    description: interpolate`Policy for rust-build artifacts bucket (cluster: ${clusterName})`,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: AWS_S3_MULTIPART_ACTIONS,
          Resource: [
            interpolate`arn:aws:s3:::${rustBuildBucket.bucket}`,
            interpolate`arn:aws:s3:::${rustBuildBucket.bucket}/*`,
          ],
        },
      ],
    },
  },
  { parent: rustBuildBucket },
);

export const rustBuildRole = eksServiceAccount(
  's3-rust-build-role',
  {
    roleName: 'EKSRustBuild-',
    roleDescription: interpolate`Service account for rust-build artifacts (cluster: ${clusterName})`,
    serviceAccountName: 'rust-build',
    oidcProviderArn: oidcProvider.arn,
    namespace: 'rust-build',
    managedPolicyArns: [policy.arn],
  },
  { parent: rustBuildBucket },
);

import * as awsClassic from '@pulumi/aws';
import { interpolate } from '@pulumi/pulumi';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { clusterFullName, oidcProvider, tags } from '../../common/k8s/coreRef.ts';
import { AWS_S3_MULTIPART_ACTIONS } from '../../constants/external.ts';

// This stack owns its artifact-transfer AWS resources so it stays self-contained
// — which means `pulumi up` on rust-build needs AWS credentials (alongside the
// Tailscale kube access). The k8s exec channel drops the tail of large streams,
// so builders upload artifacts to this transient bucket and the client pulls a
// presigned URL directly. Access is scoped to the rust-build SA via IRSA.
export const bucket = new awsClassic.s3.BucketV2('rust-build-artifacts', {
  bucket: `bes-k8s-${clusterFullName}-rust-build`,
  tags: tags.apply((t) => ({ Purpose: 'k8s-rust-build-artifacts', ...t })),
});

new awsClassic.s3.BucketLifecycleConfigurationV2(
  'rust-build-artifacts-lifecycle',
  {
    bucket: bucket.id,
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
  { parent: bucket },
);

const policy = new awsClassic.iam.Policy(
  'rust-build-artifacts-policy',
  {
    namePrefix: 'EKSRustBuild-',
    description: 'Policy for the rust-build artifacts bucket',
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
  'rust-build-artifacts-role',
  {
    roleName: 'EKSRustBuild-',
    roleDescription: 'Service account for rust-build artifacts',
    serviceAccountName: 'rust-build',
    oidcProviderArn: oidcProvider,
    namespace: 'rust-build',
    managedPolicyArns: [policy.arn],
  },
  { parent: bucket },
);

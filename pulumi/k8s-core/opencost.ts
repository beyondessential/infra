import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { clusterName, oidcProvider, tags } from './cluster.ts';
import { $core } from '../common/coreRef.ts';
import { stackName } from '../common/coreRef.ts';
import { AWS_S3_MULTIPART_ACTIONS } from '../constants/external.ts';

const spotDataFeed = $core.get<{ bucketName: string; arn: string }>('spotDataFeed');
const spotDataFeedArn = spotDataFeed.apply((b) => b.arn);

const spotPolicy = new awsNative.iam.ManagedPolicy(
  'opencost-spot-policy',
  {
    description: interpolate`OpenCost Spot Data Feed access (cluster: ${clusterName})`,
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'SpotDataAccess',
          Effect: 'Allow',
          Action: [
            's3:ListAllMyBuckets',
            's3:ListBucket',
            's3:HeadBucket',
            's3:HeadObject',
            's3:List*',
            's3:Get*',
          ],
          Resource: [spotDataFeedArn, interpolate`${spotDataFeedArn}/*`],
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

export const exportBucket = new awsClassic.s3.BucketV2('opencost-exports', {
  bucket: `bes-k8s-${stackName}-opencost-exports`,
  tags: {
    Purpose: 'opencost-exports',
    ...tags,
  },
});

new awsClassic.s3.BucketVersioningV2(
  'opencost-exports-versioning',
  {
    bucket: exportBucket.bucket,
    versioningConfiguration: { status: 'Enabled' },
  },
  { parent: exportBucket },
);

new awsClassic.s3.BucketLifecycleConfigurationV2(
  'opencost-exports-lifecycle',
  {
    bucket: exportBucket.bucket,
    rules: [
      {
        id: 'expire-noncurrent',
        status: 'Enabled',
        filter: {},
        noncurrentVersionExpiration: { noncurrentDays: 30 },
      },
    ],
  },
  { parent: exportBucket },
);

const exportPolicy = new awsNative.iam.ManagedPolicy(
  'opencost-export-policy',
  {
    description: interpolate`OpenCost CSV export bucket access (cluster: ${clusterName})`,
    policyDocument: jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ExportBucketAccess',
          Effect: 'Allow',
          Action: AWS_S3_MULTIPART_ACTIONS,
          Resource: [
            interpolate`arn:aws:s3:::${exportBucket.bucket}`,
            interpolate`arn:aws:s3:::${exportBucket.bucket}/*`,
          ],
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);

export const role = eksServiceAccount('opencost-sa-role', {
  roleName: 'EKSOpenCost-',
  roleDescription: interpolate`OpenCost service account (cluster: ${clusterName})`,
  serviceAccountName: 'opencost',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'metrics-system',
  managedPolicyArns: [spotPolicy.policyArn, exportPolicy.policyArn],
});

export const spotDataFeedBucketName = spotDataFeed.apply((b) => b.bucketName);
export const opencostExportBucketName = exportBucket.bucket;

import * as awsClassic from '@pulumi/aws';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { addAddon, clusterName, oidcProvider } from '../cluster.ts';
import { interpolate } from '@pulumi/pulumi';
import { AWS_S3_DELETE_ACTIONS } from '../../constants/external.ts';
import { cfg } from '../../common/coreRef.ts';

const s3buckets: string[] = cfg.getObject('s3buckets') ?? [];

const policy = new awsClassic.iam.Policy('s3-csi-controller', {
  namePrefix: 'AmazonS3CSIDriverPolicy-',
  description: interpolate`Mountpoint for Amazon S3 CSI driver (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: AWS_S3_DELETE_ACTIONS,
        Resource: s3buckets.flatMap((bucket) => [
          interpolate`arn:aws:s3:::${bucket}`,
          interpolate`arn:aws:s3:::${bucket}/*`,
        ]),
      },
    ],
  },
});

const ebsRole = eksServiceAccount('eks-s3-csi', {
  serviceAccountName: 's3-csi-controller-sa',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'kube-system',
  managedPolicyArns: [policy.arn],
});

addAddon('aws-mountpoint-s3-csi-driver', {
  purpose: 'system',
  serviceAccountRoleArn: ebsRole.arn,
  resolveConflicts: 'PRESERVE',
});

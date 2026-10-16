import * as awsClassic from '@pulumi/aws';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { addAddon, clusterName, oidcProvider } from '../cluster.ts';
import { interpolate } from '@pulumi/pulumi';
import { cfg } from '../../common/coreRef.ts';

const s3buckets: string[] = cfg.getObject('s3buckets') ?? [];
if (s3buckets.length > 0) {
  const policy = new awsClassic.iam.Policy('s3-csi-controller', {
    namePrefix: 'AmazonS3CSIDriverPolicy-',
    description: interpolate`Mountpoint for Amazon S3 CSI driver (cluster: ${clusterName})`,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: ['s3:*'],
          Resource: s3buckets.flatMap((bucket) => [
            `arn:aws:s3:::${bucket}`,
            `arn:aws:s3:::${bucket}/*`,
          ]),
        },
      ],
    },
  });

  const role = eksServiceAccount('eks-s3-csi', {
    serviceAccountName: 's3-csi-driver-sa', // value set by addon
    oidcProviderArn: oidcProvider.arn,
    namespace: 'kube-system',
    managedPolicyArns: [policy.arn],
  });

  addAddon('aws-mountpoint-s3-csi-driver', {
    purpose: 'system',
    serviceAccountRoleArn: role.arn,
    resolveConflicts: 'PRESERVE',
  });
}

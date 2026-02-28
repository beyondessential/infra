import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { clusterName, oidcProvider } from './cluster.ts';
import { $core } from '../common/coreRef.ts';

const spotDataFeed = $core.get<{ bucketName: string; arn: string }>('spotDataFeed');
const spotDataFeedArn = spotDataFeed.apply((b) => b.arn);

const policy = new awsNative.iam.ManagedPolicy(
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

export const role = eksServiceAccount('opencost-sa-role', {
  roleName: 'EKSOpenCost-',
  roleDescription: interpolate`OpenCost service account (cluster: ${clusterName})`,
  serviceAccountName: 'opencost',
  oidcProviderArn: oidcProvider.arn,
  namespace: 'metrics-system',
  managedPolicyArns: [policy.policyArn],
});

export const spotDataFeedBucketName = spotDataFeed.apply((b) => b.bucketName);

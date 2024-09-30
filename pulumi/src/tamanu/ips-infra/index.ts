import { failIfIncorrectCluster, clusterName, oidcProvider } from '../../common/k8s/coreRef.js';
await failIfIncorrectCluster();

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { BucketWebsite } from '../../common/BucketWebsite.js';
import { AWS_STS } from '../../constants/external.js';
import { LOGS_BUCKETS } from '../../constants/internal.js';
import { BUCKET_NAME, ZONE_ID } from './constants.js';
import { eksServiceAccount } from '../../common/eksServiceAccount.js';

const SERVICE_ACCOUNT_NAME = 'ips-bucket';

new BucketWebsite('ips', {
  domain: 'public.tamanu.io',
  bucketName: BUCKET_NAME,
  zoneId: ZONE_ID,
  logsBucket: LOGS_BUCKETS.TAMANU,
  requestFunctionSourceFile: join(dirname(fileURLToPath(import.meta.url)), 'request-function.js'),
  tags: {
    Purpose: 'Tamanu-IPS',
  },
});

const policy = new awsClassic.iam.Policy('ips-bucket-policy', {
  namePrefix: 'EKSIpsBucket-',
  description: interpolate`Policy for EKS ips-bucket (cluster: ${clusterName})`,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
        Resource: [BUCKET_NAME].flatMap((bucket) => [
          `arn:aws:s3:::${bucket}`,
          `arn:aws:s3:::${bucket}/viewer/*`,
        ]),
      },
    ],
  },
});

new awsClassic.iam.Role('gha-ips-s3-viewer', {
  name: 'gha-ips-s3-viewer',
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: 'arn:aws:iam::143295493206:oidc-provider/token.actions.githubusercontent.com',
        },
        Condition: {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': AWS_STS,
            'token.actions.githubusercontent.com:sub':
              'repo:beyondessential/ips-viewer:ref:refs/heads/main',
          },
        },
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'IPSViewerPush',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
            Resource: [BUCKET_NAME].flatMap((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/viewer/*`,
            ]),
          },
        ],
      }),
    },
  ],
});

const sa = eksServiceAccount('ips-bucket-role', {
  roleName: 'EKSIpsBucket-',
  roleDescription: interpolate`Service account for ips bucket (cluster: ${clusterName})`,
  serviceAccountName: SERVICE_ACCOUNT_NAME,
  oidcProviderArn: oidcProvider,
  namespace: 'tamanu-*',
  managedPolicyArns: [policy.arn],
});

export const serviceAccountArn = sa.arn;

import { jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { BucketWebsite } from "../../common/BucketWebsite.js";
import { AWS_STS } from '../../constants/external.js';
import { LOGS_BUCKETS } from "../../constants/internal.js";
import { BUCKET_NAME, ZONE_ID } from "./constants.js";

new BucketWebsite('ips', {
  domain: 'public.tamanu.io',
  bucketName: BUCKET_NAME,
  zoneId: ZONE_ID,
  logsBucket: LOGS_BUCKETS.TAMANU,
  tags: {
    Purpose: 'Tamanu-IPS',
  },
  unprotectBucket: true,
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
            Resource: [
              BUCKET_NAME,
            ].flatMap((bucket) => [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/viewer/*`]),
          },
        ],
      }),
    },
  ],
});

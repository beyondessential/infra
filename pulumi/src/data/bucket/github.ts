import { jsonStringify } from '@pulumi/pulumi';
import { Role } from '@pulumi/aws/iam/index.js';
import { ghaOidc } from '../../common/coreRef.ts';
import { AWS_STS, AWS_S3_WRITE_ACTIONS } from '../../constants/external.ts';
import { BUCKET, ROLE_NAME, GHA_CLAIMS } from './config.ts';

export const role = new Role('github-actions-deploy', {
  name: ROLE_NAME,
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'sts:AssumeRoleWithWebIdentity',
        Principal: {
          Federated: ghaOidc.arn,
        },
        Condition: ghaOidc.url.apply((url) => ({
          StringEquals: {
            [`${url}:aud`]: AWS_STS,
          },
          StringLike: {
            [`${url}:sub`]: GHA_CLAIMS,
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuDeploy',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: AWS_S3_WRITE_ACTIONS,
            Resource: [`arn:aws:s3:::${BUCKET}`, `arn:aws:s3:::${BUCKET}/*`],
          },
        ],
      }),
    },
  ],
});

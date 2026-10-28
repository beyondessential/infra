import { jsonStringify } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { ghaOidc } from '../../common/coreRef.ts';
import { AWS_STS } from '../../constants/external.ts';
import { PREVIEWS_PREFIX, PROD_PREFIX, REPO } from './constants.ts';
import { tags, website } from './website.ts';

// spec: BLWEB#deploy-roles
function deployRole(name: string, subject: string, prefix: string): aws.iam.Role {
  const bucketArn = website.bucket.arn;
  return new aws.iam.Role(name, {
    name,
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
              [`${url}:sub`]: subject,
            },
          })),
        },
      ],
    },
    inlinePolicies: [
      {
        name: 'BlitiWebDeploy',
        policy: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['s3:GetBucketLocation'],
              Resource: bucketArn,
            },
            {
              Effect: 'Allow',
              Action: ['s3:ListBucket'],
              Resource: bucketArn,
              Condition: {
                StringLike: {
                  's3:prefix': [`${prefix}*`],
                },
              },
            },
            {
              Effect: 'Allow',
              Action: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:AbortMultipartUpload',
                's3:ListMultipartUploadParts',
              ],
              Resource: bucketArn.apply((arn) => `${arn}/${prefix}*`),
            },
            {
              Effect: 'Allow',
              Action: [
                'cloudfront:CreateInvalidation',
                'cloudfront:GetInvalidation',
                'cloudfront:ListInvalidations',
              ],
              Resource: website.distribution.arn,
            },
          ],
        }),
      },
    ],
    tags,
  });
}

export const prodRole = deployRole(
  'gha-bliti-web-prod',
  `repo:${REPO}:environment:production`,
  PROD_PREFIX,
);

export const previewRole = deployRole(
  'gha-bliti-web-preview',
  `repo:${REPO}:pull_request`,
  PREVIEWS_PREFIX,
);

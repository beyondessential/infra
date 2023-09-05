import { jsonStringify } from '@pulumi/pulumi';
import { OpenIdConnectProvider, Role } from '@pulumi/aws/iam/index.js';
import { AWS_STS, GITHUB_OIDC_THUMBPRINTS, GITHUB_OIDC_URL } from '../../constants/external.js';
import { BUCKET, DB_SECRET_ARN } from './constants.js';

// Github Actions OIDC roles for CD
// https://github.com/aws-actions/configure-aws-credentials#sample-iam-oidc-cloudformation-template
const oidcProvider = new OpenIdConnectProvider('github-actions', {
  clientIdLists: [AWS_STS],
  url: GITHUB_OIDC_URL,
  thumbprintLists: GITHUB_OIDC_THUMBPRINTS,
});

new Role(
  'github-actions-deploy',
  {
    name: 'gha-dbt-docs',
    assumeRolePolicy: {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'sts:AssumeRoleWithWebIdentity',
          Principal: {
            Federated: oidcProvider.arn,
          },
          Condition: oidcProvider.url.apply((url) => ({
            StringEquals: {
              [`${url}:aud`]: AWS_STS,
            },
            StringLike: {
              [`${url}:sub`]: [
                // Data Lake
                'repo:beyondessential/data-lake:pull_request',
                'repo:beyondessential/data-lake:ref:refs/heads/dev',
                'repo:beyondessential/data-lake:ref:refs/tags/v*.*.*',

                // Data Lake
                'repo:beyondessential/tamanu-modules-dbt:pull_request',
                'repo:beyondessential/tamanu-modules-dbt:ref:refs/heads/dev',
                'repo:beyondessential/tamanu-modules-dbt:ref:refs/tags/v*.*.*',

                // Testing
                'repo:beyondessential/data-lake:ref:refs/heads/docs-deploy',
                'repo:beyondessential/tamanu-modules-dbt:ref:refs/heads/docs-deploy',
              ],
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
              Action: [
                's3:GetObject',
                's3:GetBucketLocation',
                's3:ListBucket',
                's3:PutObject',
              ],
              Resource: [
                `arn:aws:s3:::${BUCKET}`,
                `arn:aws:s3:::${BUCKET}/*`,
              ],
            },
            {
              Effect: 'Allow',
              Action: [
                'secretsmanager:GetSecretValue',
              ],
              Resource: [DB_SECRET_ARN],
            },
          ],
        }),
      },
    ],
  },
  { parent: oidcProvider },
);

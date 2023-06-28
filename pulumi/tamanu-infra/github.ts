import { OpenIdConnectProvider, Role } from '@pulumi/aws/iam';
import { PolicyAttachment } from '@pulumi/aws/iam';
import { jsonStringify } from '@pulumi/pulumi';

import { pushToRepoPolicy } from './repos';

// Github Actions OIDC roles for CD
// https://github.com/aws-actions/configure-aws-credentials#sample-iam-oidc-cloudformation-template
// https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/
const oidcProvider = new OpenIdConnectProvider('github-actions', {
  clientIdLists: ['sts.amazonaws.com'],
  url: 'https://token.actions.githubusercontent.com',
  thumbprintLists: [
    '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
    '6938fd4d98bab03faadb97b34396831e3780aea1',
  ],
});

const buildRole = new Role(
  'github-actions-build',
  {
    name: 'gha-build',
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
              [`${url}:aud`]: 'sts.amazonaws.com',
            },
            StringLike: {
              [`${url}:sub`]: [
                // Tamanu builds
                'repo:beyondessential/tamanu:pull_request',
                'repo:beyondessential/tamanu:ref:refs/heads/main',
                'repo:beyondessential/tamanu:ref:refs/heads/release/*',
                'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

                // Tamanu builds (testbed)
                'repo:beyondessential/tamanu-new-branching:pull_request',

                // Configurator glue container
                'repo:beyondessential/ops:ref:refs/heads/main',
              ],
            },
          })),
        },
      ],
    },
    inlinePolicies: [
      {
        name: 'DockerLogin',
        policy: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['ecr:GetAuthorizationToken'],
              Resource: '*',
            },
          ],
        }),
      },
    ],
  },
  { parent: oidcProvider },
);

new PolicyAttachment(
  'github-actions-build-ecr-push',
  {
    policyArn: pushToRepoPolicy.arn,
    roles: [buildRole],
  },
  { parent: buildRole },
);

new Role(
  'github-actions-deploy',
  {
    name: 'gha-deploy',
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
              [`${url}:aud`]: 'sts.amazonaws.com',
            },
            StringLike: {
              [`${url}:sub`]: [
                // Tamanu builds
                'repo:beyondessential/tamanu:pull_request',
                'repo:beyondessential/tamanu:ref:refs/heads/main',
                'repo:beyondessential/tamanu:ref:refs/heads/release/*',
                'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

                // Tamanu builds (testbed)
                'repo:beyondessential/tamanu-new-branching:pull_request',
                'repo:beyondessential/tamanu-new-branching:ref:refs/heads/main',
                'repo:beyondessential/tamanu-new-branching:ref:refs/heads/release/*',
                'repo:beyondessential/tamanu-new-branching:ref:refs/tags/v*.*.*',
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
                // TODO: tighten this up
                'ecs:*',
                'logs:*',
                'secretsmanager:*',
                'elasticloadbalancing:*',
                'acm:*',
                'ssm:*',
                'route53:*',
                'lambda:*',
                'servicediscovery:*',
                'rds:*',

                'iam:AttachRolePolicy',
                'iam:*Policy',
                'iam:*PolicyVersion',
                'iam:*Role',
                'iam:*RolePolicy',
                'iam:List*Policies',
                'iam:ListPolicyVersions',
              ],
              Resource: '*',
            },
          ],
        }),
      },
    ],
  },
  { parent: oidcProvider },
);

new Role(
  'github-actions-desktop-s3',
  {
    name: 'gha-desktop-s3',
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
              [`${url}:aud`]: 'sts.amazonaws.com',
            },
            StringLike: {
              [`${url}:sub`]: [
                // Tamanu builds
                'repo:beyondessential/tamanu:pull_request',
                'repo:beyondessential/tamanu:ref:refs/heads/main',
                'repo:beyondessential/tamanu:ref:refs/heads/release/*',
                'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

                // Tamanu builds (testbed)
                'repo:beyondessential/tamanu-new-branching:pull_request',
              ],
            },
          })),
        },
      ],
    },
    inlinePolicies: [
      {
        name: 'TamanuDesktopClientS3',
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
                'arn:aws:s3:::bes-tamanu-dev-desktop-clients',
                'arn:aws:s3:::bes-tamanu-dev-desktop-clients/*',
                'arn:aws:s3:::bes-tamanu-release-clients',
                'arn:aws:s3:::bes-tamanu-release-clients/*',
              ],
            },
          ],
        }),
      },
    ],
  },
  { parent: oidcProvider },
);

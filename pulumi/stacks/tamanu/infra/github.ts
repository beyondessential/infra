import { jsonStringify } from '@pulumi/pulumi';
import { Role, PolicyAttachment } from '@pulumi/aws/iam/index.js';
import { AWS_STS } from '../../constants/external.ts';
import { ghaOidc } from '../../common/coreRef.ts';
import { pushToRepoPolicy, pullFromRepoPolicy } from './repos.ts';

const imagePushRole = new Role('github-actions-image-push', {
  name: 'gha-image-push',
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
            [`${url}:sub`]: [
              // Tamanu builds
              'repo:beyondessential/tamanu:*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',

              // Configurator and ECS Router glue containers
              'repo:beyondessential/ops:pull_request',
              'repo:beyondessential/ops:ref:refs/heads/main',
            ],
          },
        })),
      },
    ],
  },
});

new PolicyAttachment(
  'github-actions-image-push-ecr-push',
  {
    policyArn: pushToRepoPolicy.arn,
    roles: [imagePushRole],
  },
  { parent: imagePushRole },
);

const imagePullRole = new Role('github-actions-image-pull', {
  name: 'gha-image-pull',
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
            [`${url}:sub`]: [
              // Tamanu builds
              'repo:beyondessential/tamanu:*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',
            ],
          },
        })),
      },
    ],
  },
});

new PolicyAttachment(
  'github-actions-image-pull-ecr-pull',
  {
    policyArn: pullFromRepoPolicy.arn,
    roles: [imagePullRole],
  },
  { parent: imagePullRole },
);

const oldBuildRole = new Role('github-actions-build', {
  name: 'gha-build',
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
            [`${url}:sub`]: [
              // Tamanu builds
              'repo:beyondessential/tamanu:pull_request',
              'repo:beyondessential/tamanu:ref:refs/heads/main',
              'repo:beyondessential/tamanu:ref:refs/heads/release/*',
            ],
          },
        })),
      },
    ],
  },
});

new PolicyAttachment(
  'github-actions-build-ecr-push',
  {
    policyArn: pushToRepoPolicy.arn,
    roles: [oldBuildRole],
  },
  { parent: oldBuildRole },
);

new Role('github-actions-deploy', {
  name: 'gha-deploy',
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
            [`${url}:sub`]: [
              // Tamanu builds
              'repo:beyondessential/tamanu:pull_request',
              'repo:beyondessential/tamanu:ref:refs/heads/main',
              'repo:beyondessential/tamanu:ref:refs/heads/release/*',
              'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',
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
});

// deprecated
new Role('github-actions-desktop-s3', {
  name: 'gha-desktop-s3',
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
            [`${url}:sub`]: [
              // Ops scripts
              'repo:beyondessential/ops:ref:refs/heads/main',

              // Tamanu builds
              'repo:beyondessential/tamanu:pull_request',
              'repo:beyondessential/tamanu:ref:refs/heads/main',
              'repo:beyondessential/tamanu:ref:refs/heads/release/*',
              'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',
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
            Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
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
});

new Role('github-actions-server-s3', {
  name: 'gha-server-s3',
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
            [`${url}:sub`]: [
              // Tamanu builds
              'repo:beyondessential/tamanu:pull_request',
              'repo:beyondessential/tamanu:ref:refs/heads/main',
              'repo:beyondessential/tamanu:ref:refs/heads/release/*',
              'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',

              // Tamanu builds (testbed)
              'repo:beyondessential/tamanu-repo-experiments:*',
            ],
          },
        })),
      },
    ],
  },
  inlinePolicies: [
    {
      name: 'TamanuServerBuildsS3',
      policy: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:GetBucketLocation', 's3:ListBucket', 's3:PutObject'],
            Resource: [
              'arn:aws:s3:::bes-tamanu-release-servers',
              'arn:aws:s3:::bes-tamanu-release-servers/*',
            ],
          },
        ],
      }),
    },
  ],
});

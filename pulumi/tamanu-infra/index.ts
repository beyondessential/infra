import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { ClusterInfra } from './ClusterInfra';
import { Network } from './Network';
import { OpenIdConnectProvider, Policy, Role } from '@pulumi/aws/iam';
import { PolicyAttachment } from '@pulumi/aws/iam';
import { jsonStringify } from '@pulumi/pulumi';

const repositories = ['central', 'configurator', 'facility', 'meta'].map((image) => ({
  image,
  repo: new Repository(`tamanu-${image}`, {
    repositoryName: `tamanu/${image}`,
    imageTagMutability: RepositoryImageTagMutability.Mutable,
  }),
}));

export const repos = Object.fromEntries(
  repositories.map(({ image, repo }) => [image, repo.repositoryUri]),
);

const pushToRepoPolicy = new Policy('ECRTamanuPush', {
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:ListImages',
          'ecr:DescribeImages',
          'ecr:BatchGetImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
        ],
        Resource: repositories.map(({ repo }) => repo.arn),
      },
    ],
  },
});

export const { outputs: network } = new Network('internal', {
  ipv4Cidr: '10.0.0.0/16',
  tags: {
    Application: 'Tamanu',
    Cluster: 'internal',
  },
});

export const { outputs: cluster } = new ClusterInfra('internal', {
  network,
  zone: 'Z0565335834ZM6R45IL3',
  tags: {
    Application: 'Tamanu',
  },
});

// ECS Exec support
// https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html#ecs-exec-enabling-and-using
export const { arn: ssmExecPolicy } = new Policy('ECSTaskPolicyForSSMExec', {
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        Resource: '*',
      },
    ],
  },
});

// Github Actions OIDC roles for CD
// https://github.com/aws-actions/configure-aws-credentials#sample-iam-oidc-cloudformation-template
const oidcProvider = new OpenIdConnectProvider('github-actions', {
  clientIdLists: ['sts.amazonaws.com'],
  url: 'https://token.actions.githubusercontent.com',
  thumbprintLists: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
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
                'repo:beyondessential/tamanu:pull_request',
                'repo:beyondessential/tamanu:ref:refs/heads/main',
                'repo:beyondessential/tamanu:ref:refs/heads/dev',
                'repo:beyondessential/tamanu:ref:refs/tags/v*.*.*',
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

export const cdRoles = { build: buildRole.arn };

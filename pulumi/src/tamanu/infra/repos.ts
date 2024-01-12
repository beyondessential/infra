import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr/index.js';
import { Policy, getPolicyDocumentOutput } from '@pulumi/aws/iam/index.js';
import { AWS_ORG_ID } from '../../constants/internal.js';
import {
  AWS_ECR_AUTH_ACTIONS,
  AWS_ECR_PULL_ACTIONS,
  AWS_ECR_PUSH_ACTIONS,
} from '../../constants/external.js';

export const repositories = [
  'central',
  'configurator',
  'ecs-router',
  'facility',
  'frontend',
  'meta',
].map((image) => {
  const policy = getPolicyDocumentOutput({
    statements: [
      {
        sid: 'ReadonlyAccessWithinWholeOrg',
        effect: 'Allow',
        principals: [
          {
            type: '*',
            identifiers: ['*'],
          },
        ],
        actions: AWS_ECR_PULL_ACTIONS,
        conditions: [
          {
            test: 'StringEquals',
            variable: 'aws:PrincipalOrgID',
            values: [AWS_ORG_ID],
          },
        ],
      },
    ],
  });

  const repo = new Repository(`tamanu-${image}`, {
    repositoryName: `tamanu/${image}`,
    imageTagMutability: RepositoryImageTagMutability.Mutable,
    repositoryPolicyText: policy.json,
  });

  return {
    image,
    repo,
  };
});

export const pushToRepoPolicy = new Policy('ECRTamanuPush', {
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: AWS_ECR_PUSH_ACTIONS,
        Resource: repositories.map(({ repo }) => repo.arn),
      },
      {
        Effect: 'Allow',
        Action: AWS_ECR_AUTH_ACTIONS,
        Resource: '*',
      },
    ],
  },
});

export const pullFromRepoPolicy = new Policy('ECRTamanuPull', {
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: AWS_ECR_PULL_ACTIONS,
        Resource: repositories.map(({ repo }) => repo.arn),
      },
      {
        Effect: 'Allow',
        Action: AWS_ECR_AUTH_ACTIONS,
        Resource: '*',
      },
    ],
  },
});

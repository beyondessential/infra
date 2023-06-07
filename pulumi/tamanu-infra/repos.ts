import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { Policy } from '@pulumi/aws/iam';

export const repositories = ['central', 'configurator', 'facility', 'meta'].map((image) => ({
  image,
  repo: new Repository(`tamanu-${image}`, {
    repositoryName: `tamanu/${image}`,
    imageTagMutability: RepositoryImageTagMutability.Mutable,
  }),
}));

export const pushToRepoPolicy = new Policy('ECRTamanuPush', {
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

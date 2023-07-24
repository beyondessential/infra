import { getAmiOutput } from '@pulumi/aws/ec2/index.js';

export const AWS_STS = 'sts.amazonaws.com';

export const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';

// https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/
export const GITHUB_OIDC_THUMBPRINTS = [
  '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
  '6938fd4d98bab03faadb97b34396831e3780aea1',
];

export const AWS_ECR_PULL_ACTIONS = [
  'ecr:BatchCheckLayerAvailability',
  'ecr:BatchGetImage',
  'ecr:DescribeImageScanFindings',
  'ecr:DescribeImages',
  'ecr:DescribeRepositories',
  'ecr:GetAuthorizationToken',
  'ecr:GetDownloadUrlForLayer',
  'ecr:GetRepositoryPolicy',
  'ecr:ListImages',
];

export const AWS_ECR_PUSH_ACTIONS = [
  ...AWS_ECR_PULL_ACTIONS,
  'ecr:CompleteLayerUpload',
  'ecr:InitiateLayerUpload',
  'ecr:PutImage',
  'ecr:UploadLayerPart',
];

export function alpineAmi(
  version: string = '3.*',
  arch: string = 'aarch64',
  userdata: string = 'tiny',
) {
  return getAmiOutput({
    mostRecent: true,
    filters: [
      {
        name: 'name',
        values: [`alpine-${version}-${arch}-uefi-${userdata}-r0`],
        // tiny = https://gitlab.alpinelinux.org/alpine/cloud/tiny-cloud
      },
      {
        name: 'virtualization-type',
        values: ['hvm'],
      },
    ],
    owners: ['538276064493'], // official Alpine images
  });
}

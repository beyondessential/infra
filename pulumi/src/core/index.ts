import { Config } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { Network } from '../common/Network.js';
import { AWS_STS, GITHUB_OIDC_THUMBPRINTS, GITHUB_OIDC_URL } from '../constants/external.js';

const cfg = new Config();
const v6 = cfg.requireBoolean('networkV6');
const forEksCluster = cfg.getBoolean('forEksCluster');

export const tags: { [key: string]: string } = cfg.getObject('tags') ?? {};
export const { outputs: network } = new Network('core-network', {
  // Generally this should be 10.xx.0.0/16,
  // where xx is the last two digits of the AWS account,
  // unless that conflicts with something else.
  ipv4Cidr: cfg.require('networkV4'),
  v6,
  eksSubnetTags: forEksCluster ? {} : false,
  tags,
});

export const { arn: dbSubnetGroup } = new aws.rds.SubnetGroup('core-workload', {
  subnetIds: network.workloadSubnetIds,
  tags: {
    Purpose: 'database',
    ...tags,
  },
});

// Github Actions OIDC roles for CD
const oidcProvider = new aws.iam.OpenIdConnectProvider('github-actions', {
  clientIdLists: [AWS_STS],
  url: GITHUB_OIDC_URL,
  // Not strictly needed anymore for github
  thumbprintLists: GITHUB_OIDC_THUMBPRINTS,
});
export const ghaOidc = {
  arn: oidcProvider.arn,
  url: oidcProvider.url,
};

// https://docs.aws.amazon.com/eks/latest/userguide/cni-iam-role.html#cni-iam-role-create-ipv6-policy
export const eksCniV6Policy = v6
  ? new aws.iam.Policy('eks-cni-ipv6', {
      name: 'AmazonEKS_CNI_IPv6_Policy',
      description: 'Policy for EKS CNI IPv6',
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ec2:AssignIpv6Addresses',
              'ec2:DescribeInstances',
              'ec2:DescribeTags',
              'ec2:DescribeNetworkInterfaces',
              'ec2:DescribeInstanceTypes',
            ],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['ec2:CreateTags'],
            Resource: ['arn:aws:ec2:*:*:network-interface/*'],
          },
        ],
      },
    }).arn
  : null;

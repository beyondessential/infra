import * as awsClassic from '@pulumi/aws';

import { forEksCluster, v6 } from './config.js';

// https://docs.aws.amazon.com/eks/latest/userguide/cni-iam-role.html#cni-iam-role-create-ipv6-policy
export const eksCniV6Policy =
  v6 && forEksCluster
    ? new awsClassic.iam.Policy('eks-cni-ipv6', {
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

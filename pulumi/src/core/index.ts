import { Config, interpolate } from '@pulumi/pulumi';
import * as aws from '@pulumi/aws-native';
import * as awsClassic from '@pulumi/aws';
import { region } from '../common/awsAccount.js';
import { Network } from '../common/Network.js';
import { AWS_STS, GITHUB_OIDC_THUMBPRINTS, GITHUB_OIDC_URL } from '../constants/external.js';

export { accountId } from '../common/awsAccount.js';

const cfg = new Config();
const v6 = cfg.requireBoolean('networkV6');
const forEksCluster = cfg.getBoolean('forEksCluster');
const privateSubnets = (cfg.getBoolean('privateSubnets') ?? true) || forEksCluster;
const publicSubnets = cfg.getBoolean('publicSubnets') ?? true;
const withEndpoints = cfg.getBoolean('withEndpoints') || forEksCluster;
const withGithubOidc = (cfg.getBoolean('withGithubOidc') ?? true) || forEksCluster;

export const tags: { [key: string]: string } = cfg.getObject('tags') ?? {};
const $network = new Network('core-network', {
  // Generally this should be 10.xx.0.0/16,
  // where xx is the last two digits of the AWS account,
  // unless that conflicts with something else.
  ipv4Cidr: cfg.require('networkV4'),
  v6,
  privateSubnets,
  publicSubnets,
  eksSubnetTags: forEksCluster ? {} : false,
  tags,
});
export const network = $network.outputs;

export const { arn: dbSubnetGroup } = privateSubnets
  ? new awsClassic.rds.SubnetGroup('core-workload', {
      subnetIds: network.workloadSubnetIds,
      tags: {
        Purpose: 'database',
        ...tags,
      },
    })
  : { arn: undefined };

if (withEndpoints) {
  new awsClassic.ec2.VpcEndpoint('core-endpoint-s3', {
    serviceName: interpolate`com.amazonaws.${region}.s3`,
    vpcId: network.vpc,
    routeTableIds: [...$network.nats, ...$network.workloads, ...$network.publicWorkloads].map(
      (sub) => sub.routes.id,
    ),
    tags: {
      Name: 'core-endpoint-s3',
      ...tags,
    },
  });

  if (privateSubnets || publicSubnets) {
    // for ipv6/dualstack support see Private Endpoints column:
    // https://docs.aws.amazon.com/vpc/latest/userguide/aws-ipv6-support.html
    for (const service of [
      // list of useful endpoints from here:
      // https://docs.aws.amazon.com/eks/latest/userguide/private-clusters.html
      'ec2',
      'ecr.api',
      'ecr.dkr',
      'elasticloadbalancing',
      'logs',
      'sts',
    ]) {
      const slug = service.replace(/[^a-z0-9]+/g, '-');
      new awsClassic.ec2.VpcEndpoint(`core-endpoint-workload-${slug}`, {
        serviceName: interpolate`com.amazonaws.${region}.${service}`,
        vpcId: network.vpc,
        privateDnsEnabled: true,
        subnetIds: (privateSubnets
          ? $network.workloads
          : publicSubnets
            ? $network.publicWorkloads
            : []
        ).map((sub) => sub.subnet.id),
        vpcEndpointType: 'Interface',
        tags: {
          Name: `core-endpoint-${slug}`,
          ...tags,
        },
      });
    }
  }
}

let oidcProvider;
if (withGithubOidc) {
  // Github Actions OIDC roles for CD
  oidcProvider = new awsClassic.iam.OpenIdConnectProvider('github-actions', {
    clientIdLists: [AWS_STS],
    url: GITHUB_OIDC_URL,
    // Not strictly needed anymore for github
    thumbprintLists: GITHUB_OIDC_THUMBPRINTS,
  });
}
export const ghaOidc = {
  arn: oidcProvider?.arn,
  url: oidcProvider?.url,
};

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

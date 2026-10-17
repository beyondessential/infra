import { interpolate } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import { accountId, region } from '../../common/awsAccount.ts';
import { Network } from '../../common/Network.ts';

import {
  enableDnsHostnames,
  forEksCluster,
  privateSubnets,
  publicSubnets,
  tags,
  v4,
  v6,
} from './config.ts';

// `karpenter.sh/*` and `karpenter.k8s.aws/*` tags on subnets, route tables,
// and security groups are owned by downstream stacks (k8s-core). Ignoring
// them at the provider level keeps core from treating them as drift and
// stripping them on every `pulumi up`.
// spec: CORE#network
const networkAws = new awsClassic.Provider('core-network-aws', {
  region,
  ignoreTags: {
    keyPrefixes: ['karpenter.sh/', 'karpenter.k8s.aws/'],
  },
});

const logGroup = new awsClassic.cloudwatch.LogGroup('core-network-flow-logs', {
  name: '/aws/vpc/flowlogs/core-network',
  retentionInDays: 30,
  tags,
});

// spec: CORE#network
// spec: CORE#egress
const $network = accountId.apply((id) => {
  const ipv4Cidr = v4 === true ? `10.${parseInt(id.slice(-2), 10)}.0.0/16` : v4;

  return new Network(
    'core-network',
    {
      ipv4Cidr,
      v6,
      privateSubnets,
      publicSubnets,
      eksSubnetTags: forEksCluster ? {} : false,
      enableDnsHostnames,
      tags,
    },
    { providers: [networkAws] },
  );
});
export const network = $network.outputs;

const iamRole = new awsClassic.iam.Role('core-network-flow-logs', {
  assumeRolePolicy: awsClassic.iam.assumeRolePolicyForPrincipal({
    Service: 'vpc-flow-logs.amazonaws.com',
  }),
  tags,
});

new awsClassic.iam.RolePolicy('core-network-flow-logs', {
  role: iamRole.id,
  policy: awsClassic.iam
    .getPolicyDocumentOutput({
      statements: [
        {
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogGroups',
            'logs:DescribeLogStreams',
          ],
          resources: [interpolate`${logGroup.arn}:*`],
        },
      ],
    })
    .apply((doc) => doc.json),
});

network.vpc.apply((vpcId) => {
  new awsClassic.ec2.FlowLog('core-network-flow-logs', {
    iamRoleArn: iamRole.arn,
    logDestination: logGroup.arn,
    trafficType: 'REJECT',
    vpcId,
    tags,
  });
});

export const { arn: dbSubnetGroup } = privateSubnets
  ? new awsClassic.rds.SubnetGroup('core-workload', {
      subnetIds: network.workloadSubnetIds,
      tags: {
        Purpose: 'database',
        ...tags,
      },
    })
  : { arn: undefined };

$network.apply((net) => {
  new awsClassic.ec2.VpcEndpoint('core-endpoint-s3', {
    serviceName: interpolate`com.amazonaws.${region}.s3`,
    vpcId: network.vpc,
    routeTableIds: [...net.nats, ...net.workloads, ...net.publicWorkloads].map(
      (sub) => sub.routes.id,
    ),
    tags: {
      Name: 'core-endpoint-s3',
      ...tags,
    },
  });
});

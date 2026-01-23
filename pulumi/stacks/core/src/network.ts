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
  withEndpoints,
} from './config.ts';

const logGroup = new awsClassic.cloudwatch.LogGroup('core-network-flow-logs', {
  name: '/aws/vpc/flowlogs/core-network',
  retentionInDays: 30,
  tags,
});

const $network = accountId.apply((id) => {
  const ipv4Cidr = v4 === true ? `10.${parseInt(id.slice(-2), 10)}.0.0/16` : v4;

  return new Network('core-network', {
    ipv4Cidr,
    v6,
    privateSubnets,
    publicSubnets,
    eksSubnetTags: forEksCluster ? {} : false,
    enableDnsHostnames,
    tags,
  });
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

if (withEndpoints) {
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

    if (privateSubnets || publicSubnets) {
      // for ipv6/dualstack support see Private Endpoints column:
      // https://docs.aws.amazon.com/vpc/latest/userguide/aws-ipv6-support.html
      for (const service of [
        // list of useful endpoints from here:
        // https://docs.aws.amazon.com/eks/latest/userguide/private-clusters.html
        'ec2',
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
            ? net.workloads
            : publicSubnets
              ? net.publicWorkloads
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
  });
}

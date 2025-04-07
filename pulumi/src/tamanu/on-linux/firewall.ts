import * as aws from '@pulumi/aws';
import { normalizedStack, namePrefix } from './config.js';
import { $network } from '../../common/coreRef.js';
import * as securityGroupRules from '../../common/securityGroupRules.js';

export const sg = new aws.ec2.SecurityGroup(
  normalizedStack,
  {
    vpcId: $network.vpc,
    description: normalizedStack,
    ingress: [
      ...securityGroupRules.allICMP,
      securityGroupRules.openPort('HTTP', 80),
      securityGroupRules.openPort('HTTPS', 443),
      securityGroupRules.openPort('HTTP3', 443, 'udp'),
    ],
    egress: [securityGroupRules.all],
    tags: {
      Name: `${namePrefix}${normalizedStack}`,
      Purpose: 'workload',
    },
  },
  {
    ignoreChanges: ['ingress', 'egress', 'description'],
  },
);

import * as aws from '@pulumi/aws';
import { billingTags, normalizedStack, namePrefix } from './config.ts';
import { $network } from '../../../common/coreRef.ts';
import * as securityGroupRules from '../../../common/securityGroupRules.ts';

export const sg = new aws.ec2.SecurityGroup(
  normalizedStack,
  {
    vpcId: $network.vpc,
    description: normalizedStack,
    ingress: [
      // spec: LNXAWS#network-exposure
      ...securityGroupRules.allICMP,
      securityGroupRules.openPort('HTTP', 80),
      securityGroupRules.openPort('HTTPS', 443),
      securityGroupRules.openPort('HTTP3', 443, 'udp'),
    ],
    egress: [securityGroupRules.all],
    tags: {
      Name: `${namePrefix}${normalizedStack}`,
      ManagedBy: 'pulumi',
      Purpose: 'tamanu-server',
      ...billingTags,
    },
  },
  {
    ignoreChanges: ['ingress', 'egress', 'description'],
  },
);

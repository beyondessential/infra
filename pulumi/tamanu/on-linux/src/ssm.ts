import * as aws from '@pulumi/aws';
import { jsonStringify } from '@pulumi/pulumi';

import { billingTags, normalizedStack } from './config.ts';

const tags = {
  Purpose: 'tamanu-server',
  ManagedBy: 'pulumi',
  ...billingTags,
};

// spec: LNXAWS#recovery-access
const role = new aws.iam.Role('instance-ssm', {
  namePrefix: `${normalizedStack.slice(0, 40)}-ssm-`,
  assumeRolePolicy: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'ec2.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
  managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'],
  tags,
});

// spec: LNXAWS#recovery-access
export const instanceProfile = new aws.iam.InstanceProfile('instance', {
  namePrefix: `${normalizedStack.slice(0, 40)}-`,
  role: role.name,
  tags,
});

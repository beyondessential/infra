import * as awsNative from '@pulumi/aws';
import { AWS_PRIMARY_ACCOUNT_ID } from '../../constants/internal.ts';
if ((await awsNative.getCallerIdentity()).accountId !== AWS_PRIMARY_ACCOUNT_ID) {
  throw new Error('This is not the correct _BES Primary account ID');
}

import { getStack } from '@pulumi/pulumi';
if (getStack() === 'ap-southeast-2') {
  await import('./passwords.ts');
  await import('./default-vpc.ts');
}

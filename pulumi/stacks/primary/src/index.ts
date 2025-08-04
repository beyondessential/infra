import * as awsNative from '@pulumi/aws';
if ((await awsNative.getCallerIdentity()).accountId !== '295280690919') {
  throw new Error('This is not the correct _BES Primary account ID');
}

import { topic as alertTopic } from './alerts.ts';
export const alertTopicArn = alertTopic.arn;

import { getStack } from '@pulumi/pulumi';
if (getStack() === 'ap-southeast-2') {
  await import('./passwords.ts');
}

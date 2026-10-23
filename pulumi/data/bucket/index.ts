import { interpolate } from '@pulumi/pulumi';
import { BUCKET, ROLE_NAME } from './config.ts';
import { accountId, region } from '../../common/awsAccount.ts';
import { cfg, failIfIncorrectAccountOrRegion } from '../../common/coreRef.ts';
await failIfIncorrectAccountOrRegion();

import { applyBucketPolicy } from './bucket.ts';
import './github.ts';

if (cfg.getBoolean('website')) {
  await import('./website.ts');
}

export const awsRegion = region;
export const bucket = BUCKET;
export const roleToAssume = interpolate`arn:aws:iam::${accountId}:role/${ROLE_NAME}`;

applyBucketPolicy();

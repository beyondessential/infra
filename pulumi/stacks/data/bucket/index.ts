import { interpolate } from '@pulumi/pulumi';
import { BUCKET, ROLE_NAME } from './config.ts';
import { accountId, region } from '../../common/awsAccount.ts';
import { failIfIncorrectAccount } from '../../common/coreRef.ts';
failIfIncorrectAccount();

import './website.ts';
import './github.ts';

export const awsRegion = region;
export const bucket = BUCKET;
export const roleToAssume = interpolate`arn:aws:iam::${accountId}:role/${ROLE_NAME}`;

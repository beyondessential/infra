import { interpolate } from '@pulumi/pulumi';
import { BUCKET, ROLE_NAME } from './config.js';
import { accountId, region } from '../../common/awsAccount.js';
import { failIfIncorrectAccount } from '../../common/coreRef.js';
failIfIncorrectAccount();

import './website.js';
import './github.js';

export const awsRegion = region;
export const bucket = BUCKET;
export const roleToAssume = interpolate`arn:aws:iam::${accountId}:role/${ROLE_NAME}`;

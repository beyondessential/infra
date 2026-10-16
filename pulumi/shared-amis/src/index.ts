import './guard.ts';

import './ebs-encryption.ts';
import './oidc.ts';
import './vmimport.ts';

import { staging } from './bucket.ts';
import { role } from './role.ts';

export const { bucket } = staging;
export const roleArn = role.arn;

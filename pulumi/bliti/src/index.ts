import { failIfIncorrectAccountOrRegion } from '../../common/coreRef.ts';
await failIfIncorrectAccountOrRegion();

import { website } from './website.ts';
import { previewRole, prodRole } from './roles.ts';

// spec: BLWEB#outputs
export const bucket = website.bucket.bucket;
export const distributionId = website.distribution.id;
export const prodRoleArn = prodRole.arn;
export const previewRoleArn = previewRole.arn;

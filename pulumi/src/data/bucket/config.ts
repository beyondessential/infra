import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/coreRef.js';
import { LOGS_BUCKETS } from '../../constants/internal.js';

const normalizedStack = getStack()
  .toLowerCase()
  .replaceAll(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // max length for a domain label
  .replaceAll(/^-+|-+$/g, '');

export const DOMAIN = `${cfg.get('domain') ?? normalizedStack}.data.bes.au`;
export const BUCKET = cfg.get('bucket') ?? `bes-data-${normalizedStack}`;
export const ROLE_NAME = cfg.get('role') ?? `gha-s3-${normalizedStack}`;

export const GHA_CLAIMS: string[] = cfg.getObject('ghaClaims') ?? [];

export const ZONE_ID = 'Z07801321MEVDI0D1XE18';
export const LOGS_BUCKET = LOGS_BUCKETS.DATA;

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BucketWebsite } from '../../common/BucketWebsite.ts';
import { LOGS_BUCKETS } from '../../constants/internal.ts';
import * as awsClassic from '@pulumi/aws';

const zoneId = 'Z07118832KOZ96U06G6JA';

export const tools = new BucketWebsite('tools', {
  domain: 'tools.ops.tamanu.io',
  bucketName: 'bes-ops-tools',
  zoneId,
  logsBucket: LOGS_BUCKETS.TAMANU,
  requestFunctionSourceFile: join(
    dirname(fileURLToPath(import.meta.url)),
    'bucket-tools-request-function.js',
  ),
  tags: {
    Purpose: 'ops',
  },
});

export const servers = new BucketWebsite('servers', {
  domain: 'servers.ops.tamanu.io',
  bucketName: 'bes-tamanu-release-servers',
  zoneId,
  logsBucket: LOGS_BUCKETS.TAMANU,
  bucketItselfPublic: true,
  tags: {
    Purpose: 'ops',
  },
});

export const clients = new BucketWebsite('clients', {
  domain: 'clients.ops.tamanu.io',
  bucketName: 'bes-tamanu-release-clients',
  zoneId,
  logsBucket: LOGS_BUCKETS.TAMANU,
  bucketItselfPublic: true,
  importBucket: 'bes-tamanu-release-clients',
  tags: {
    Purpose: 'tamanu-clients',
  },
});

export const translations = new BucketWebsite('translations', {
  domain: 'translations.ops.tamanu.io',
  bucketName: 'bes-tamanu-translations',
  zoneId,
  logsBucket: LOGS_BUCKETS.TAMANU,
  bucketItselfPublic: false,
  tags: {
    Purpose: 'tamanu-translations',
  },
});

export const dbDumps = new awsClassic.s3.Bucket('bes-tamanu-test-data-snapshots-bucket', {
  bucket: 'bes-tamanu-test-data-snapshots',
});

new awsClassic.s3.BucketLifecycleConfiguration(
  'data-snapshots-lifecycle',
  {
    bucket: dbDumps.bucket,
    rules: [
      {
        id: 'delete-after-a-year',
        status: 'Enabled',
        expiration: { days: 300 },
        noncurrentVersionExpiration: {
          noncurrentDays: 65,
        },
      },
    ],
  },
  { parent: dbDumps },
);

new awsClassic.s3.BucketIntelligentTieringConfiguration(
  'data-snapshots-tiering',
  {
    bucket: dbDumps.bucket,
    status: 'Enabled',
    tierings: [
      {
        accessTier: 'DEEP_ARCHIVE_ACCESS',
        days: 180,
      },
    ],
  },
  { parent: dbDumps },
);

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as aws from '@pulumi/aws';
import { BucketWebsite } from '../../common/BucketWebsite.ts';
import { $core } from '../../common/coreRef.ts';
import { LOGS_BUCKETS } from '../../constants/internal.ts';
import { BUCKET, DOMAIN, PREVIEWS_PREFIX, PREVIEW_EXPIRY_DAYS } from './constants.ts';

const here = dirname(fileURLToPath(import.meta.url));

export const tags = {
  ...(await $core.getValue<{ [key: string]: string }>('tags')),
  Purpose: 'bliti-web',
};

// spec: BLWEB#addresses
// spec: BLWEB#routing
// spec: BLWEB#pre-compressed-variants
export const website = new BucketWebsite('web', {
  domain: DOMAIN,
  extraDomains: [`*.${DOMAIN}`],
  bucketName: BUCKET,
  zoneId: await $core.getValue<string>('zoneId'),
  logsBucket: LOGS_BUCKETS.TAMANU,
  listableByDistribution: true,
  requestFunctionSourceFile: join(here, 'request-function.js'),
  responseFunctionSourceFile: join(here, 'response-function.js'),
  tags,
});

// spec: BLWEB#bucket
new aws.s3.BucketLifecycleConfiguration(
  'web-lifecycle',
  {
    bucket: website.bucket.bucket,
    rules: [
      {
        id: 'expire-previews',
        status: 'Enabled',
        filter: { prefix: PREVIEWS_PREFIX },
        expiration: { days: PREVIEW_EXPIRY_DAYS },
      },
      {
        id: 'abort-incomplete-uploads',
        status: 'Enabled',
        filter: {},
        abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
      },
    ],
  },
  { parent: website.bucket },
);

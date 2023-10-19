import { BucketWebsite } from "../../common/BucketWebsite.js";
import { LOGS_BUCKETS } from "../../constants/internal.js";
import './github.js';

const zoneId = 'Z07118832KOZ96U06G6JA';

new BucketWebsite('tools', {
  domain: 'tools.ops.tamanu.io',
  bucketName: 'bes-ops-tools',
  zoneId,
  logsBucket: LOGS_BUCKETS.TAMANU,
  tags: {
    Purpose: 'ops',
  },
});

new BucketWebsite('servers', {
  domain: 'servers.ops.tamanu.io',
  bucketName: 'bes-tamanu-release-servers',
  zoneId,
  logsBucket: LOGS_BUCKETS.TAMANU,
  bucketItselfPublic: true,
  tags: {
    Purpose: 'ops',
  },
});

new BucketWebsite('clients', {
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

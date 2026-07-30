import * as k8s from '@pulumi/kubernetes';
import {
  backupRetentionDays,
  costLabels,
  dbExpose,
  dbStorage,
  normalizedStack,
} from './config.ts';
import { runPostgres } from '../../common/k8s/postgres.ts';
import { backups } from '../../common/k8s/coreRef.ts';

import { namespace } from './namespace.ts';
import './ca.ts';

export const dbReady = runPostgres({
  namespace,
  name: 'meta',
  replicas: 2,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  // WAL archiving plus nightly base backups to S3, which retention actually
  // applies to and which recover to a point in time rather than to Monday.
  barmanBackup: {
    bucket: backups.bucket,
    deployName: normalizedStack,
    retentionDays: backupRetentionDays,
  },
  inheritedMetadataLabels: costLabels,
  maxConnections: 200,
  // Sized against the working set rather than the pod's floor: the database is
  // ~48GB and the instances hold 13-15GiB of page cache over it, with a 95th
  // percentile working set of 5.8GiB. This yields 2GB of shared_buffers.
  memoryRequest: '8Gi',
  scrapeMetrics: true,
});

if (dbExpose) {
  new k8s.core.v1.Service('meta-db-tailscale', {
    metadata: {
      namespace,
      annotations: {
        'tailscale.com/hostname': `${normalizedStack}-db`,
        'tailscale.com/tags': 'tag:k8s-proxy,tag:server,tag:server-tamanu,tag:server-tamanu-meta',
      },
    },
    spec: {
      type: 'LoadBalancer',
      loadBalancerClass: 'tailscale',
      selector: {
        'cnpg.io/cluster': 'meta-db',
        'cnpg.io/instanceRole': 'replica',
      },
      allocateLoadBalancerNodePorts: false,
      ports: [
        {
          protocol: 'TCP',
          port: 5432,
          targetPort: 5432,
          name: 'postgresql',
        },
      ],
    },
  });
}

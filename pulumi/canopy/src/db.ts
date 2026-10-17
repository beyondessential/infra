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

// spec: K8SCNP#database
export const dbReady = runPostgres({
  namespace,
  name: 'meta',
  replicas: 2,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  // WAL archiving plus nightly base backups to S3, which retention actually
  // applies to and which recover to a point in time rather than to Monday.
  // spec: K8SBAK#recovery-window
  barmanBackup: {
    bucket: backups.bucket,
    deployName: normalizedStack,
    retentionDays: backupRetentionDays,
  },
  inheritedMetadataLabels: costLabels,
  maxConnections: 200,
  // Sized against the working set rather than the pod's floor; this yields 2GB
  // of shared_buffers, and the dedicated node's remaining memory is page cache
  // over the database.
  memoryRequest: '8Gi',
  // Off spot: Canopy depends on this database, and each reclaim of a node
  // holding the primary forced a switchover and a cold cache.
  placement: 'dedicated',
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

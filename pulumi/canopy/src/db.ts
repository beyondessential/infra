import * as k8s from '@pulumi/kubernetes';
import { costLabels, dbExpose, dbStorage, normalizedStack } from './config.ts';
import { runPostgres } from '../../common/k8s/postgres.ts';

import { namespace } from './namespace.ts';
import './ca.ts';

export const dbReady = runPostgres({
  namespace,
  name: 'meta',
  replicas: 2,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  backupSchedule: true,
  inheritedMetadataLabels: costLabels,
  maxConnections: 200,
  memoryRequest: '2Gi',
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

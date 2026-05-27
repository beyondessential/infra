import * as k8s from '@pulumi/kubernetes';
import { costLabels, dbExpose, dbStorage, normalizedStack } from './config.ts';
import { runPostgres } from '../../../common/k8s/postgres.ts';

import { namespace } from './namespace.ts';

export const dbReady = runPostgres({
  namespace,
  name: 'dhis2',
  replicas: 2,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  backupSchedule: false,
  postgis: true,
  inheritedMetadataLabels: costLabels,
  initSql: `
      CREATE EXTENSION IF NOT EXISTS postgis;
    `
    .replace(/^[ \t]+/gm, '')
    .trim(),
});

if (dbExpose) {
  new k8s.core.v1.Service('dhis2-db-tailscale', {
    metadata: {
      namespace,
      annotations: {
        'tailscale.com/hostname': `${normalizedStack}-db`,
        'tailscale.com/tags': 'tag:k8s-proxy,tag:server,tag:server-tamanu,tag:server-tamanu-dhis2',
      },
    },
    spec: {
      type: 'LoadBalancer',
      loadBalancerClass: 'tailscale',
      selector: {
        'cnpg.io/cluster': 'dhis2-db',
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

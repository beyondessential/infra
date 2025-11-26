import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { spec } from './spec.ts';
import { labels } from './labels.ts';
import { dbReady } from './db.ts';
import { PostgresUrlSecretKey } from '../../../common/k8s/postgresUrl.ts';
import { architecture } from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';

export const migrator = new k8s.batch.v1.Job('migrator', {
  metadata: {
    namespace,
  },
  spec: {
    backoffLimit: 5,
    template: {
      spec: {
        ...spec('migrate', ['migrate', 'run']),
        restartPolicy: 'Never',
      },
    },
  },
});

new k8s.apps.v1.Deployment(
  'ownstatus',
  {
    metadata: {
      labels: labels('ownstatus'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('ownstatus'),
      },
      template: {
        metadata: {
          labels: labels('ownstatus'),
        },
        spec: spec('ownstatus', ['ownstatus']),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.apps.v1.Deployment(
  'pingtask',
  {
    metadata: {
      labels: labels('pingtask'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('pingtask'),
      },
      template: {
        metadata: {
          labels: labels('pingtask'),
        },
        spec: spec('pingtask', ['pingtask']),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.batch.v1.CronJob(
  'prune',
  {
    metadata: {
      labels: labels('prune'),
      namespace,
    },
    spec: {
      schedule: '@daily',
      jobTemplate: {
        metadata: {
          labels: labels('prune'),
        },
        spec: {
          backoffLimit: 5,
          template: {
            spec: {
              ...spec('prune', ['prune_untrusted_devices']),
              restartPolicy: 'Never',
            },
          },
        },
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.batch.v1.CronJob(
  'db-statuses-partition',
  {
    metadata: {
      labels: labels('db-statuses-partition'),
      namespace,
    },
    spec: {
      schedule: '@daily',
      jobTemplate: {
        metadata: {
          labels: labels('db-statuses-partition'),
        },
        spec: {
          backoffLimit: 3,
          template: {
            metadata: {
              labels: labels('db-statuses-partition'),
            },
            spec: {
              tolerations: [CAN_RUN_ON_SPOT],
              affinity: {
                nodeAffinity: {
                  preferredDuringSchedulingIgnoredDuringExecution: [
                    {
                      weight: 1,
                      preference: RUN_ON_SPOT,
                    },
                  ],
                  requiredDuringSchedulingIgnoredDuringExecution: {
                    nodeSelectorTerms: [
                      {
                        matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
                      },
                    ],
                  },
                },
              },
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'db-statuses-partition',
                  image: 'postgres',
                  command: ['psql'],
                  args: ['-c', 'SELECT create_statuses_partitions(2);'],
                  env: [
                    {
                      name: 'PGDATABASE',
                      value: 'app',
                    },
                    {
                      name: 'PGHOST',
                      value: 'meta-db-rw',
                    },
                    {
                      name: 'PGUSER',
                      value: 'app',
                    },
                    {
                      name: 'PGPASSWORD',
                      valueFrom: {
                        secretKeyRef: dbReady.apply((url) => ({
                          name: url.metadata.name,
                          key: PostgresUrlSecretKey.AppPassword,
                        })),
                      },
                    },
                  ],
                  resources: {
                    requests: {
                      cpu: '10m',
                      memory: '32Mi',
                    },
                    limits: {
                      cpu: '100m',
                      memory: '128Mi',
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
  { dependsOn: [migrator] },
);

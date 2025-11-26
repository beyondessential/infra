import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { spec } from './spec.ts';
import { labels } from './labels.ts';
import { dbReady } from './db.ts';
import { architecture } from './config.ts';
import { postgresCronJob } from '../../../common/k8s/postgresCron.ts';

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

postgresCronJob(
  'prune',
  {
    namespace,
    schedule: '@daily',
    command: 'SELECT prune_untrusted_devices();',
    dbReady,
    dbService: 'meta-db-rw',
    architecture,
    labels: labels('prune'),
  },
  { dependsOn: [migrator] },
);

postgresCronJob(
  'db-statuses-partition',
  {
    namespace,
    schedule: '@daily',
    command: 'SELECT create_statuses_partitions(2);',
    dbReady,
    dbService: 'meta-db-rw',
    architecture,
    labels: labels('db-statuses-partition'),
  },
  { dependsOn: [migrator] },
);

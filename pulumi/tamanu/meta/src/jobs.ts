import * as k8s from '@pulumi/kubernetes';
import { TAILNET_DOMAIN } from '../../../constants/internal.ts';
import { postgresCronJob } from '../../../common/k8s/postgresCron.ts';
import { namespace } from './namespace.ts';
import { spec } from './spec.ts';
import { labels } from './labels.ts';
import { dbReady } from './db.ts';
import { architecture, slackerOpenUrl, slackerCloseUrl, normalizedStack } from './config.ts';

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

new k8s.apps.v1.Deployment(
  'reachability',
  {
    metadata: {
      labels: labels('reachability'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('reachability'),
      },
      template: {
        metadata: {
          labels: labels('reachability'),
        },
        spec: spec('reachability', ['reachability']),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.apps.v1.Deployment(
  'slacker',
  {
    metadata: {
      labels: labels('slacker'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('slacker'),
      },
      template: {
        metadata: {
          labels: labels('slacker'),
        },
        spec: spec('slacker', ['slacker_outbox'], {
          env: [
            { name: 'PRIVATE_URL', value: `https://${normalizedStack}.${TAILNET_DOMAIN}` },
            { name: 'SLACK_WEBHOOK_OPEN_URL', value: slackerOpenUrl },
            { name: 'SLACK_WEBHOOK_RESOLVE_URL', value: slackerCloseUrl },
          ],
        }),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.batch.v1.CronJob('chrome-versions', {
  metadata: {
    namespace,
  },
  spec: {
    schedule: '@daily',
    jobTemplate: {
      metadata: {
        labels: labels('pingtask'),
      },
      spec: {
        backoffLimit: 5,
        template: {
          spec: {
            ...spec('chrome-versions', ['chrome_versions']),
            restartPolicy: 'Never',
          },
        },
      },
    },
  },
});

postgresCronJob('prune', {
  namespace,
  schedule: '@daily',
  command: 'SELECT prune_untrusted_devices();',
  dbReady,
  dbService: 'meta-db-rw',
  architecture,
  labels: labels('prune'),
});

postgresCronJob('partition-statuses', {
  namespace,
  schedule: '@daily',
  command: 'SELECT create_statuses_partitions(2);',
  dbReady,
  dbService: 'meta-db-rw',
  architecture,
  labels: labels('partition-statuses'),
});

postgresCronJob('partition-device-connections', {
  namespace,
  schedule: '@daily',
  command: 'SELECT create_device_connections_partitions(2);',
  dbReady,
  dbService: 'meta-db-rw',
  architecture,
  labels: labels('partition-device-connections'),
});

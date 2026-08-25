import * as k8s from '@pulumi/kubernetes';
import { TAILNET_DOMAIN } from '../../constants/internal.ts';
import { postgresCronJob } from '../../common/k8s/postgresCron.ts';
import { namespace } from './namespace.ts';
import { spec } from './spec.ts';
import { canopyJobsSa } from './canopy-sa.ts';
import { recoveryEnv } from './canopy-recovery.ts';
import { sharedBackupsJobsEnv } from './canopy-backups-shared.ts';
import { labels } from './labels.ts';
import { dbReady } from './db.ts';
import {
  architecture,
  costLabels,
  slackerOpenUrl,
  slackerCloseUrl,
  slackerSelfAlertUrl,
  normalizedStack,
} from './config.ts';

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
  'monitor',
  {
    metadata: {
      labels: labels('monitor'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('monitor'),
      },
      template: {
        metadata: {
          labels: { ...labels('monitor'), ...costLabels },
        },
        spec: spec('monitor', ['monitor']),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.apps.v1.Deployment(
  'backups',
  {
    metadata: {
      labels: labels('backups'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('backups'),
      },
      template: {
        metadata: {
          labels: { ...labels('backups'), ...costLabels },
        },
        spec: spec(
          'backups',
          ['backups'],
          { env: [...recoveryEnv, ...sharedBackupsJobsEnv] },
          { serviceAccountName: canopyJobsSa },
        ),
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
          labels: { ...labels('slacker'), ...costLabels },
        },
        spec: spec('slacker', ['slacker_outbox'], {
          env: [
            { name: 'PRIVATE_URL', value: `https://${normalizedStack}.${TAILNET_DOMAIN}` },
            { name: 'SLACK_WEBHOOK_OPEN_URL', value: slackerOpenUrl },
            { name: 'SLACK_WEBHOOK_RESOLVE_URL', value: slackerCloseUrl },
            { name: 'SLACK_WEBHOOK_SELF_ALERT_URL', value: slackerSelfAlertUrl },
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

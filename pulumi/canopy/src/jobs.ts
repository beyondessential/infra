import * as k8s from '@pulumi/kubernetes';
import { TAILNET_DOMAIN } from '../../constants/internal.ts';
import { postgresCronJob } from '../../common/k8s/postgresCron.ts';
import { namespace } from './namespace.ts';
import { spec } from './spec.ts';
import { artifactStoreEnv } from './canopy-artifacts.ts';
import { canopyDomainsSa, canopyJobsSa } from './canopy-sa.ts';
import { recoveryEnv } from './canopy-recovery.ts';
import { sharedBackupsJobsEnv } from './canopy-backups-shared.ts';
import { labels } from './labels.ts';
import { dbReady } from './db.ts';
import { acmeEnv } from './canopy-acme.ts';
import {
  architecture,
  costLabels,
  slackerOpenUrl,
  slackerCloseUrl,
  slackerSelfAlertUrl,
  slackerMaintenanceDeclaredUrl,
  slackerMaintenanceEndedUrl,
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
        spec: spec('monitor', ['monitor'], {}, { pooled: true }),
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
          // The sweep drops artifact bytes no registration reaches any more.
          { env: [...recoveryEnv, ...sharedBackupsJobsEnv, ...artifactStoreEnv] },
          { serviceAccountName: canopyJobsSa, pooled: true },
        ),
      },
    },
  },
  { dependsOn: [migrator] },
);

// The pod that holds the zone access: it publishes the addresses of the names
// servers register, and drives certificate orders through the DNS-01 challenge.
// Neither is on a request path — a server asks for a certificate and collects it
// later — so this being briefly down delays issuance rather than failing it,
// which is why one replica and Recreate are enough.
new k8s.apps.v1.Deployment(
  'domains',
  {
    metadata: {
      labels: labels('domains'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('domains'),
      },
      template: {
        metadata: {
          labels: { ...labels('domains'), ...costLabels },
        },
        spec: spec(
          'domains',
          ['domains'],
          // Absent means no account to order with: addresses carry on and
          // certificates wait, which the pod reports once at startup.
          // spec: CTLS#certificate-authority-account
          { env: acmeEnv },
          { serviceAccountName: canopyDomainsSa, pooled: true },
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
        spec: spec(
          'slacker',
          ['slacker_outbox'],
          {
            env: [
              { name: 'PRIVATE_URL', value: `https://${normalizedStack}.${TAILNET_DOMAIN}` },
              { name: 'SLACK_WEBHOOK_OPEN_URL', value: slackerOpenUrl },
              { name: 'SLACK_WEBHOOK_RESOLVE_URL', value: slackerCloseUrl },
              { name: 'SLACK_WEBHOOK_SELF_ALERT_URL', value: slackerSelfAlertUrl },
              ...(slackerMaintenanceDeclaredUrl
                ? [
                    {
                      name: 'SLACK_WEBHOOK_MAINTENANCE_DECLARED_URL',
                      value: slackerMaintenanceDeclaredUrl,
                    },
                  ]
                : []),
              ...(slackerMaintenanceEndedUrl
                ? [
                    {
                      name: 'SLACK_WEBHOOK_MAINTENANCE_ENDED_URL',
                      value: slackerMaintenanceEndedUrl,
                    },
                  ]
                : []),
            ],
          },
          { pooled: true },
        ),
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

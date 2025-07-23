import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { spec } from './spec.ts';
import { labels } from './labels.ts';

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

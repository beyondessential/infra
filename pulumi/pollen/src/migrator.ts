import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { image, cpuRequest, memoryRequest } from './config.ts';
import { scheduling, databaseUrlEnv } from './pod.ts';

// Applies the embedded migrations before the server rolls out. The Job's pod
// template changes with the image tag, so each deploy replaces (re-runs) it.
export const migrator = new k8s.batch.v1.Job('pollen-migrate', {
  metadata: {
    namespace,
  },
  spec: {
    backoffLimit: 5,
    template: {
      metadata: {
        labels,
      },
      spec: {
        ...scheduling,
        restartPolicy: 'Never',
        containers: [
          {
            name: 'migrate',
            image,
            command: ['migrate', 'run'],
            env: [databaseUrlEnv],
            resources: {
              requests: {
                cpu: cpuRequest,
                memory: memoryRequest,
              },
            },
          },
        ],
      },
    },
  },
});

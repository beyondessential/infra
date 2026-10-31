import * as k8s from '@pulumi/kubernetes';
import { deployments, image } from './config.ts';
import { namespace } from './namespace.ts';
import { pullSecret, pullSecretName } from './imagePullSecret.ts';
import { sa } from './serviceAccount.ts';

// Nightly run, one CronJob per deployment — no GPU needed at expected daily
// volume (low hundreds of encounters). CPU inference is slower per encounter
// (~18-30s observed locally with gemma4:e2b) but comfortably finishes
// overnight. The historical backfill is a separate, one-off GPU Job, kept as
// a kubectl-applied template (deploy/k8s/job-backfill.yaml in
// disease-outbreak-detection) rather than Pulumi-managed, since each run is
// immutable and date-named rather than a persistent, idempotent resource.
for (const deployment of deployments) {
  new k8s.batch.v1.CronJob(`outbreak-detection-${deployment}-daily`, {
    metadata: {
      namespace,
      name: `outbreak-detection-${deployment}-daily`,
    },
    spec: {
      schedule: '0 16 * * *', // 02:00 local time for most Pacific deployments (UTC+10/+11/+12/+13)
      concurrencyPolicy: 'Forbid',
      successfulJobsHistoryLimit: 7,
      failedJobsHistoryLimit: 7,
      jobTemplate: {
        spec: {
          backoffLimit: 2,
          activeDeadlineSeconds: 10800, // 3h; a stuck run shouldn't block tomorrow's
          template: {
            spec: {
              restartPolicy: 'Never',
              serviceAccountName: sa.metadata.name,
              imagePullSecrets: pullSecret ? [{ name: pullSecretName }] : undefined,
              containers: [
                {
                  name: 'outbreak-detection',
                  image,
                  args: ['run'],
                  env: [{ name: 'CONFIG_PATH', value: `/config/${deployment}.yaml` }],
                  envFrom: [{ secretRef: { name: `outbreak-detection-${deployment}-db` } }],
                  resources: {
                    requests: { cpu: '1', memory: '2Gi' },
                    limits: { cpu: '2', memory: '4Gi' },
                  },
                  volumeMounts: [{ name: 'config', mountPath: '/config', readOnly: true }],
                },
              ],
              volumes: [
                {
                  name: 'config',
                  configMap: { name: `outbreak-detection-${deployment}-config` },
                },
              ],
            },
          },
        },
      },
    },
  });
}

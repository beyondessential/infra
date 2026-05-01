import * as k8s from '@pulumi/kubernetes';
import { Output } from '@pulumi/pulumi';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { schedule } from './config.ts';

// Schedule windows are expressed as "08:30-18:45 in either NZ or Sydney
// (whichever is the user's local TZ)" via a union of two kube-downscaler
// uptime specs. The CNPG hibernation CronJobs straddle that with a margin —
// DB up before any user logs in, DB down after every user logs off.
//
// User TZ assumed to be one of Pacific/Auckland or Australia/Sydney.

// kube-downscaler annotations applied to the namespace (inherited by every
// deployment / statefulset / HPA / cronjob inside it).
export const scheduleAnnotations: Record<string, string> = (() => {
  switch (schedule) {
    case 'business-hours':
      return {
        'downscaler/uptime':
          'Mon-Fri 08:30-18:45 Pacific/Auckland,Mon-Fri 08:30-18:45 Australia/Sydney',
      };
    case 'weekdays':
      return { 'downscaler/uptime': 'Mon-Fri 00:00-24:00 Pacific/Auckland' };
    case 'always-on':
      return { 'downscaler/exclude': 'true' };
  }
})();

// CNPG hibernation timing — DB straddles the workload window:
// - business-hours: wake 08:00 NZT (30min before earliest workload start, NZ
//   08:30) and hibernate 19:00 Sydney (15min after latest workload end, Syd
//   18:45). Each CronJob lives in its own timezone for clarity.
// - weekdays: wake Sun 23:45 NZT, hibernate Sat 00:15 NZT.
// - always-on: no CronJobs.
type CronWindow = { wake: CronTime; hibernate: CronTime };
type CronTime = { schedule: string; timeZone: string };

const cronWindow: CronWindow | null = (() => {
  switch (schedule) {
    case 'business-hours':
      return {
        wake: { schedule: '0 8 * * 1-5', timeZone: 'Pacific/Auckland' },
        hibernate: { schedule: '0 19 * * 1-5', timeZone: 'Australia/Sydney' },
      };
    case 'weekdays':
      return {
        wake: { schedule: '45 23 * * 0', timeZone: 'Pacific/Auckland' },
        hibernate: { schedule: '15 0 * * 6', timeZone: 'Pacific/Auckland' },
      };
    case 'always-on':
      return null;
  }
})();

export function setupCnpgHibernation(namespace: Output<string>): void {
  if (!cronWindow) return;

  const labels = { 'app.kubernetes.io/name': 'cnpg-hibernation' };

  const sa = new k8s.core.v1.ServiceAccount('cnpg-hibernation', {
    metadata: { name: 'cnpg-hibernation', namespace, labels },
  });

  const role = new k8s.rbac.v1.Role('cnpg-hibernation', {
    metadata: { name: 'cnpg-hibernation', namespace, labels },
    rules: [
      {
        apiGroups: ['postgresql.cnpg.io'],
        resources: ['clusters'],
        verbs: ['get', 'list', 'patch'],
      },
    ],
  });

  new k8s.rbac.v1.RoleBinding('cnpg-hibernation', {
    metadata: { name: 'cnpg-hibernation', namespace, labels },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: role.metadata.name,
    },
    subjects: [{ kind: 'ServiceAccount', name: sa.metadata.name, namespace }],
  });

  hibernationCronJob('cnpg-wake', namespace, sa, cronWindow.wake, 'off');
  hibernationCronJob(
    'cnpg-hibernate',
    namespace,
    sa,
    cronWindow.hibernate,
    'on',
  );
}

function hibernationCronJob(
  name: string,
  namespace: Output<string>,
  sa: k8s.core.v1.ServiceAccount,
  when: CronTime,
  value: 'on' | 'off',
): void {
  new k8s.batch.v1.CronJob(name, {
    metadata: { name, namespace },
    spec: {
      schedule: when.schedule,
      timeZone: when.timeZone,
      concurrencyPolicy: 'Forbid',
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 2,
          template: {
            spec: {
              serviceAccountName: sa.metadata.name,
              restartPolicy: 'Never',
              tolerations: [CAN_RUN_ON_SPOT],
              containers: [
                {
                  name,
                  image: 'registry.k8s.io/kubectl:v1.34.7',
                  command: ['kubectl'],
                  args: [
                    'annotate',
                    'cluster.postgresql.cnpg.io',
                    '--all',
                    `cnpg.io/hibernation=${value}`,
                    '--overwrite',
                  ],
                  resources: {
                    requests: { cpu: '10m', memory: '32Mi' },
                    limits: { memory: '128Mi' },
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
}

import * as k8s from '@pulumi/kubernetes';
import { Output } from '@pulumi/pulumi';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { ttlHours } from './config.ts';
import { namespaceName } from './namespace.ts';

// On every `pulumi up` with `ttlHours > 0`, the deployment's expiry is
// re-anchored to "now + ttlHours hours". A hibernate CronJob fires twice
// — at the next 00/20/40-minute slot at-or-after expiresAt and 10 min
// later — so the schedule fits in one cron expression within a single
// hour, with one retry against transient failures. Each firing annotates
// every Deployment in the namespace with `downscaler/force-downtime=true`
// (which kube-downscaler then scales to zero) and sets
// `cnpg.io/hibernation=on` on every CNPG cluster (which the CNPG operator
// hibernates). A wake-up Job runs on every up to reverse those
// annotations, so an expired deployment is revived by the next push.
// The actual hibernation time is therefore expiresAt rounded up to the
// next 20-min boundary — up to ~20 min of slop past the configured TTL.
//
// Suspension is driven entirely by workload-level annotations. The
// namespace itself is intentionally left without `downscaler/exclude` —
// per py-kube-downscaler, namespace-level exclude takes precedence and
// would short-circuit our workload-level force-downtime. With no
// namespace annotation and no kube-downscaler default downtime, untouched
// workloads stay up; force-downtime'd workloads scale to zero.
//
// All RBAC is namespace-scoped: this avoids needing
// ClusterRole/ClusterRoleBinding, which the gha deploy role can't create.

// spec: TSD#time-to-live
export function setupTtlHibernation(namespace: Output<string>): void {
  if (ttlHours === 0) return;

  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
  const labels = { 'app.kubernetes.io/name': 'tamanu-ttl' };

  // The name is fixed because infra-argo-tamanu-renderer's wake CronJob, which is rendered
  // and so cannot ask the stub for it, runs as this service account.
  const sa = new k8s.core.v1.ServiceAccount('tamanu-ttl', {
    metadata: { name: 'tamanu-ttl', namespace, labels },
  });

  const role = new k8s.rbac.v1.Role('tamanu-ttl', {
    metadata: { namespace, labels },
    rules: [
      {
        apiGroups: ['apps'],
        resources: ['deployments'],
        verbs: ['get', 'list', 'patch'],
      },
      {
        apiGroups: ['postgresql.cnpg.io'],
        resources: ['clusters'],
        verbs: ['get', 'list', 'patch'],
      },
    ],
  });

  new k8s.rbac.v1.RoleBinding('tamanu-ttl', {
    metadata: { namespace, labels },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: role.metadata.name,
    },
    subjects: [{ kind: 'ServiceAccount', name: sa.metadata.name, namespace }],
  });

  hibernateCronJob('ttl-hibernate', namespace, sa, cronTimeForHibernate(expiresAt));
  wakeJob(namespace, sa, expiresAtUnix);
}

type CronTime = { schedule: string; timeZone: 'UTC' };

// Round expiresAt up to the next :00/:20/:40 UTC slot, then fire there
// and 10 min later. Both firings live in the same UTC hour, so the
// schedule is one cron expression and never crosses an hour boundary.
export function cronTimeForHibernate(expiresAt: Date): CronTime {
  const SLOT_MS = 20 * 60 * 1000;
  const fireAt = new Date(Math.ceil(expiresAt.getTime() / SLOT_MS) * SLOT_MS);
  const firstMinute = fireAt.getUTCMinutes();
  return {
    schedule: `${firstMinute},${firstMinute + 10} ${fireAt.getUTCHours()} ${fireAt.getUTCDate()} ${fireAt.getUTCMonth() + 1} *`,
    timeZone: 'UTC',
  };
}

const KUBECTL_IMAGE = 'registry.k8s.io/kubectl:v1.34.7';
const CONTAINER_RESOURCES = {
  requests: { cpu: '10m', memory: '32Mi' },
  limits: { memory: '128Mi' },
};

// spec: TSD#hibernation
function hibernateCronJob(
  name: string,
  namespace: Output<string>,
  sa: k8s.core.v1.ServiceAccount,
  when: CronTime,
): void {
  new k8s.batch.v1.CronJob(name, {
    metadata: { namespace },
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
                  name: 'hibernate-deployments',
                  image: KUBECTL_IMAGE,
                  command: ['kubectl'],
                  args: [
                    'annotate',
                    'deployment',
                    '--all',
                    '-n',
                    namespaceName,
                    'downscaler/force-downtime=true',
                    '--overwrite',
                  ],
                  resources: CONTAINER_RESOURCES,
                },
                {
                  name: 'hibernate-cnpg',
                  image: KUBECTL_IMAGE,
                  command: ['kubectl'],
                  args: [
                    'annotate',
                    'cluster.postgresql.cnpg.io',
                    '--all',
                    '-n',
                    namespaceName,
                    'cnpg.io/hibernation=on',
                    '--overwrite',
                  ],
                  resources: CONTAINER_RESOURCES,
                },
              ],
            },
          },
        },
      },
    },
  });
}

// spec: TSD#waking
function wakeJob(
  namespace: Output<string>,
  sa: k8s.core.v1.ServiceAccount,
  expiresAtUnix: number,
): void {
  // Per-up unique pulumi name so each `pulumi up` deletes the previous
  // Job and creates a fresh one — Jobs are immutable and can't be re-run.
  // ttlSecondsAfterFinished cleans up the underlying k8s Job a few minutes
  // after success so old Jobs don't accumulate if pulumi state lags.
  new k8s.batch.v1.Job(`ttl-wake-${expiresAtUnix}`, {
    metadata: { namespace, annotations: { 'pulumi.com/timeoutSeconds': '600' } },
    spec: {
      ttlSecondsAfterFinished: 600,
      backoffLimit: 2,
      template: {
        spec: {
          serviceAccountName: sa.metadata.name,
          restartPolicy: 'Never',
          tolerations: [CAN_RUN_ON_SPOT],
          containers: [
            {
              name: 'wake-deployments',
              image: KUBECTL_IMAGE,
              command: ['kubectl'],
              args: [
                'annotate',
                'deployment',
                '--all',
                '-n',
                namespaceName,
                'downscaler/force-downtime-',
                '--overwrite',
              ],
              resources: CONTAINER_RESOURCES,
            },
            {
              name: 'wake-cnpg',
              image: KUBECTL_IMAGE,
              command: ['kubectl'],
              args: [
                'annotate',
                'cluster.postgresql.cnpg.io',
                '--all',
                '-n',
                namespaceName,
                'cnpg.io/hibernation=off',
                '--overwrite',
              ],
              resources: CONTAINER_RESOURCES,
            },
          ],
        },
      },
    },
  });
}

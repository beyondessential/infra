import * as k8s from '@pulumi/kubernetes';
import { Output } from '@pulumi/pulumi';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { ttlHours } from './config.ts';
import { namespaceName } from './namespace.ts';

// On every `pulumi up` with `ttlHours > 0`, the deployment's expiry is
// re-anchored to "now + ttlHours hours". A hibernate CronJob fires every
// 15 min for ~2h starting at expiresAt. Each firing annotates every
// Deployment in the namespace with `downscaler/force-downtime=true` (which
// kube-downscaler then scales to zero) and sets `cnpg.io/hibernation=on`
// on every CNPG cluster (which the CNPG operator hibernates). A wake-up
// Job runs on every up to reverse those annotations, so an expired
// deployment is revived by the next push.
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

export function setupTtlHibernation(namespace: Output<string>): void {
  if (ttlHours === 0) return;

  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
  const labels = { 'app.kubernetes.io/name': 'tamanu-ttl' };

  const sa = new k8s.core.v1.ServiceAccount('tamanu-ttl', {
    metadata: { namespace, labels },
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

  for (const [i, when] of cronGroupsForHibernate(expiresAt).entries()) {
    hibernateCronJob(`cnpg-hibernate-${i + 1}`, namespace, sa, when);
  }

  wakeJob(namespace, sa, expiresAtUnix);
}

type CronTime = { schedule: string; timeZone: 'UTC' };

// 8 quarter-hour firings starting at expiresAt, grouped by UTC hour. A
// single cron expression with comma-separated minutes within one hour
// fires exactly the times we want; spanning two hours via cross product
// would double-fire, so we emit one CronJob per UTC hour (up to 3 when the
// expiresAt minute pushes the window across hour boundaries).
export function cronGroupsForHibernate(expiresAt: Date): CronTime[] {
  type Firing = { month: number; day: number; hour: number; minute: number };
  const firings: Firing[] = [];
  for (let i = 0; i < 8; i++) {
    const t = new Date(expiresAt.getTime() + i * 15 * 60_000);
    firings.push({
      month: t.getUTCMonth() + 1,
      day: t.getUTCDate(),
      hour: t.getUTCHours(),
      minute: t.getUTCMinutes(),
    });
  }

  const groups = new Map<string, Firing[]>();
  for (const f of firings) {
    const key = `${f.month}-${f.day}-${f.hour}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  return [...groups.values()].map((group) => {
    const minutes = [...new Set(group.map((f) => f.minute))].sort((a, b) => a - b);
    const f0 = group[0];
    return {
      schedule: `${minutes.join(',')} ${f0.hour} ${f0.day} ${f0.month} *`,
      timeZone: 'UTC',
    };
  });
}

const KUBECTL_IMAGE = 'registry.k8s.io/kubectl:v1.34.7';
const CONTAINER_RESOURCES = {
  requests: { cpu: '10m', memory: '32Mi' },
  limits: { memory: '128Mi' },
};

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
              initContainers: [
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
              ],
              containers: [
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

function wakeJob(
  namespace: Output<string>,
  sa: k8s.core.v1.ServiceAccount,
  expiresAtUnix: number,
): void {
  // Per-up unique pulumi name so each `pulumi up` deletes the previous
  // Job and creates a fresh one — Jobs are immutable and can't be re-run.
  // ttlSecondsAfterFinished cleans up the underlying k8s Job a few minutes
  // after success so old Jobs don't accumulate if pulumi state lags.
  new k8s.batch.v1.Job(`cnpg-wake-${expiresAtUnix}`, {
    metadata: { namespace },
    spec: {
      ttlSecondsAfterFinished: 600,
      backoffLimit: 2,
      template: {
        spec: {
          serviceAccountName: sa.metadata.name,
          restartPolicy: 'Never',
          tolerations: [CAN_RUN_ON_SPOT],
          initContainers: [
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
          ],
          containers: [
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

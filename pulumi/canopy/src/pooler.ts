import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { dbReady } from './db.ts';

// PgBouncer in front of meta-db for the long-running services, so a switchover
// costs them only the queries in flight rather than every connection. Transaction
// pooling: Canopy holds no session state (its advisory locks are transaction
// scoped), and PgBouncer tracks the named prepared statements diesel-async caches.
// Jobs and cronjobs connect directly: they are short, and migrations need a session.
export const POOLER_RW_HOST = 'meta-pooler-rw';
export const POOLER_RO_HOST = 'meta-pooler-ro';

function pooler(name: string, type: 'rw' | 'ro') {
  const poolerLabels = labels(name);

  const resource = new k8s.apiextensions.CustomResource(name, {
    apiVersion: 'postgresql.cnpg.io/v1',
    kind: 'Pooler',
    metadata: { name, namespace, labels: poolerLabels },
    spec: {
      cluster: { name: dbReady.apply(() => 'meta-db') },
      instances: 2,
      type,
      pgbouncer: {
        poolMode: 'transaction',
        parameters: {
          // The servers cap their own pools at 10 connections a pod.
          default_pool_size: '20',
          max_db_connections: '40',
          max_client_conn: '500',
          max_prepared_statements: '200',
        },
      },
      template: {
        metadata: { labels: poolerLabels },
        spec: {
          // Alongside the database on the on-demand pool, so a reclaim never
          // moves them.
          nodeSelector: { 'bes.node.group': 'db-critical' },
          tolerations: [
            {
              key: 'bes.node.group',
              operator: 'Equal',
              value: 'db-critical',
              effect: 'NoSchedule',
            },
          ],
          affinity: {
            podAntiAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                {
                  weight: 100,
                  podAffinityTerm: {
                    labelSelector: { matchLabels: { 'cnpg.io/poolerName': name } },
                    topologyKey: 'kubernetes.io/hostname',
                  },
                },
              ],
            },
          },
          containers: [
            {
              name: 'pgbouncer',
              resources: {
                requests: { cpu: '10m', memory: '32Mi' },
                limits: { memory: '128Mi' },
              },
            },
          ],
        },
      },
    },
  });

  // CNPG gives poolers no disruption budget; keep one pod serving through drains.
  new k8s.policy.v1.PodDisruptionBudget(name, {
    metadata: { namespace, labels: poolerLabels },
    spec: {
      minAvailable: 1,
      selector: { matchLabels: { 'cnpg.io/poolerName': name } },
    },
  });

  return resource;
}

export const poolerRw = pooler(POOLER_RW_HOST, 'rw');
export const poolerRo = pooler(POOLER_RO_HOST, 'ro');

import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import type { PostgresReady } from '../../../../common/k8s/postgres.ts';
import { DEFAULT_POSTGRES_VERSION } from '../../../../constants/internal.ts';

// Tamanu's app role self-manages the tamanu_reporting/tamanu_raw roles, which on
// Postgres 16+ requires ADMIN OPTION on them — implicit only when app created them.
// Snapshot-seeded and pre-existing clusters have the roles without the grant (and
// skip initSql entirely, since recovery replaces initdb), which crash-loops every
// server on startup. Reconcile the grants as superuser on each deploy; a no-op
// when the roles are absent (fresh cluster: app creates them itself) or already
// granted.
// CREATEROLE is reconciled here too: `app` can't be a CNPG managed role (see
// reportingRoles.ts), and initSql only runs at first bootstrap.
// Named dollar-quoting: kubelet command expansion collapses an anonymous $$ to $.
const GRANTS_SQL = `
DO $do$
BEGIN
  ALTER ROLE app WITH CREATEROLE;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'tamanu_reporting') THEN
    GRANT tamanu_reporting TO app WITH ADMIN OPTION;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'tamanu_raw') THEN
    GRANT tamanu_raw TO app WITH ADMIN OPTION;
  END IF;
END $do$;
`.trim();

export interface ReportingGrantsArgs {
  parent: ComponentResource;
  // Resolves once the cluster is serving. The Job reads the superuser secret CNPG creates
  // with the cluster, and a pod whose secret is missing never starts, so it never fails
  // either: it sits in CreateContainerConfigError and holds the whole deploy.
  dbReady: PostgresReady;
}

// Per-up unique pulumi name so every `pulumi up` replaces the Job and the
// grants reconcile again (same trick as ttl-wake) — Jobs are immutable and a
// spec-stable Job never re-runs, which left a woken-from-hibernation env with
// grantless roles crash-looping. The SQL is idempotent and runs in seconds, so
// re-running each deploy costs nothing.
const deployNonce = Math.floor(Date.now() / 1000);

export function reportingGrants(
  name: string,
  { parent, dbReady }: ReportingGrantsArgs,
): k8s.batch.v1.Job {
  return new k8s.batch.v1.Job(
    `${name}-reporting-grants-${deployNonce}`,
    {
      metadata: {
        namespace,
      },
      spec: {
        // clean up the finished Job so replaced ones don't accumulate
        ttlSecondsAfterFinished: 600,
        // generous: the superuser secret can lag cluster creation
        backoffLimit: 8,
        template: {
          spec: {
            restartPolicy: 'Never',
            containers: [
              {
                name: 'grants',
                image: `postgres:${DEFAULT_POSTGRES_VERSION}`,
                command: ['psql'],
                args: ['-v', 'ON_ERROR_STOP=1', '-c', GRANTS_SQL],
                env: [
                  { name: 'PGHOST', value: dbReady.apply(() => `${name}-db-rw`) },
                  { name: 'PGDATABASE', value: 'app' },
                  { name: 'PGUSER', value: 'postgres' },
                  {
                    name: 'PGPASSWORD',
                    valueFrom: {
                      secretKeyRef: {
                        name: `${name}-db-superuser`,
                        key: 'password',
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
    { parent },
  );
}

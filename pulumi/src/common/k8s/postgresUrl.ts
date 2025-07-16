import { ComponentResource, Input, Output, all, interpolate, secret } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sConfig } from './client.ts';

export interface PostgresUrlArgs {
  parent?: ComponentResource;
  namespace: Input<string>;
  name: Input<string>;
  dbReady: Output<void | k8s.core.v1.Secret>;
}

function dbPassword(
  dbReady: Output<void | k8s.core.v1.Secret>,
  namespace: Input<string>,
  name: Input<string>,
  user: string,
): Output<null | string> {
  return secret(
    all([namespace, name, dbReady]).apply(async ([namespace, name]) => {
      try {
        const kc = k8sConfig();
        const k8sApi = kc.makeApiClient(CoreV1Api);

        const kSecret = await k8sApi.readNamespacedSecret({
          name: `${name}-db-${user}`,
          namespace,
        });
        const hidden = kSecret.data?.['password'];
        if (!hidden) {
          return null;
        }

        return Buffer.from(hidden, 'base64').toString('utf-8');
      } catch (err) {
        console.error(`Secret ${name}-db-${user} not found or not ready: ${err}`);
        return null;
      }
    }),
  );
}

export const PostgresUrlSecretKey = {
  AppPassword: 'app.password',
  AppDbUrl: 'app.dburl',
  AppRocket: 'app.rocket',
  AppLocalDbUrl: 'app.localdburl',
  AppLocalJdbc: 'app.localjdbc',
  PostgresPassword: 'postgres.password',
  PostgresDbUrl: 'postgres.dburl',
  PostgresLocalDbUrl: 'postgres.localdburl',
  PostgresLocalJdbc: 'postgres.localjdbc',
};
export type PostgresUrlSecretKey = keyof typeof PostgresUrlSecretKey;

export function postgresUrlSecret({
  parent,
  namespace,
  name,
  dbReady,
}: PostgresUrlArgs): k8s.core.v1.Secret {
  const appPassword = dbPassword(dbReady, namespace, name, 'app');
  const postgresPassword = dbPassword(dbReady, namespace, name, 'superuser');

  return new k8s.core.v1.Secret(
    `${name}-db-url`,
    {
      metadata: {
        name: `${name}-db-url`,
        namespace,
        labels: {
          'app.kubernetes.io/name': name,
          'app.kubernetes.io/component': 'database',
        },
      },
      type: 'Opaque',
      stringData: {
        [PostgresUrlSecretKey.AppPassword]: interpolate`${appPassword}`,
        [PostgresUrlSecretKey.AppDbUrl]: interpolate`postgres://app:${appPassword}@${name}-db-rw/app`,
        [PostgresUrlSecretKey.AppRocket]: interpolate`{postgres={url="postgres://app:${appPassword}@${name}-db-rw/app"}}`,
        [PostgresUrlSecretKey.AppLocalDbUrl]: interpolate`postgres://app:${appPassword}@localhost:5433/app`,
        [PostgresUrlSecretKey.AppLocalJdbc]: interpolate`jdbc:postgresql://localhost:5433/app?user=app&password=${appPassword}`,
        [PostgresUrlSecretKey.PostgresPassword]: interpolate`${postgresPassword}`,
        [PostgresUrlSecretKey.PostgresDbUrl]: interpolate`postgres://postgres:${postgresPassword}@${name}-db-rw/postgres`,
        [PostgresUrlSecretKey.PostgresLocalDbUrl]: interpolate`postgres://postgres:${postgresPassword}@localhost:5433/postgres`,
        [PostgresUrlSecretKey.PostgresLocalJdbc]: interpolate`jdbc:postgresql://localhost:5433/postgres?user=postgres&password=${postgresPassword}`,
      },
    },
    { parent },
  );
}

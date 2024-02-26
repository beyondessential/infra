import { ComponentResource, Output, interpolate, secret } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { namespace } from '../namespace.js';
import { k8sConfig } from '../../../common/k8s/client.js';
import { PostgresReady } from './postgres.js';

export interface PostgresUrlArgs {
  parent: ComponentResource;
  name: string;
  dbReady: PostgresReady,
}

function dbPassword(name: string, user: string): Output<null | string> {
  return secret(namespace.apply(async namespace => {
    const kc = k8sConfig();
    const k8sApi = kc.makeApiClient(CoreV1Api);

    const kSecret = await k8sApi.readNamespacedSecret(`${name}-db-${user}`, namespace);
    const hidden = kSecret.body.data?.['password'];
    if (!hidden) {
      return null;
    }

    return Buffer.from(hidden, 'base64').toString('utf-8');
  }));
}

export function postgresUrlSecret({ parent, name, dbReady }: PostgresUrlArgs): k8s.core.v1.Secret {
  const appPassword = dbReady.apply(() => dbPassword(name, 'app'));
  const postgresPassword = dbReady.apply(() => dbPassword(name, 'superuser'));

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
        'app.password': interpolate`${appPassword}`,
        'app.dburl': interpolate`postgres://app:${appPassword}@localhost:5433/app`,
        'app.jdbc': interpolate`jdbc:postgresql://localhost:5433/app?user=app&password=${appPassword}`,
        'postgres.password': interpolate`${postgresPassword}`,
        'postgres.dburl': interpolate`postgres://postgres:${postgresPassword}@localhost:5433/postgres`,
        'postgres.jdbc': interpolate`jdbc:postgresql://localhost:5433/postgres?user=postgres&password=${postgresPassword}`,
      },
    },
    { parent },
  );
}

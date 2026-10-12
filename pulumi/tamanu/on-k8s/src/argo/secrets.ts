import * as k8s from '@pulumi/kubernetes';
import { RandomBytes } from '@pulumi/random';
import { dbRoleSecret } from '../../../../common/k8s/dbRoleSecret.ts';
import { facilityList } from '../config.ts';
import { namespace } from '../namespace.ts';

// Secret values are never rendered, so this stub creates every Secret that the
// renderer references by name. The names are the contract in tamanu-render's
// names.rs.

export const servers = ['central', ...facilityList.map((_, i) => `facility-${i + 1}`)];

// Passwords for the legacy raw and reporting roles, as `{server}-raw-db` and
// `{server}-reporting-db`.
for (const server of servers) {
  dbRoleSecret({ name: `${server}-raw`, namespace, username: 'raw' });
  dbRoleSecret({ name: `${server}-reporting`, namespace, username: 'reporting' });
}

// Signing secrets for each server's auth tokens. The rendered config carries a
// placeholder for these; the server reads the real value from the environment,
// which takes precedence over the file.
const AUTH_SECRET_BYTES = 40;
function authSecret(name: string): RandomBytes {
  return new RandomBytes(name, { length: AUTH_SECRET_BYTES });
}

for (const server of servers) {
  new k8s.core.v1.Secret(`config-secrets-${server}`, {
    metadata: { name: `config-secrets-${server}`, namespace },
    type: 'Opaque',
    stringData: {
      authSecret: authSecret(`${server}-auth-secret`).hex,
      ...(server === 'central' && {
        authRefreshSecret: authSecret(`${server}-auth-refresh-secret`).hex,
      }),
    },
  });
}

import { ComponentResource, type Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { RandomPassword } from '@pulumi/random';

export interface RoleSecretArgs {
  parent?: ComponentResource;
  name: string;
  namespace: Input<string>;
  username: Input<string>;
  labels?: Input<Record<string, Input<string>>>;
}

export function dbRoleSecret({
  parent,
  name,
  namespace,
  username,
  labels = {},
}: RoleSecretArgs): k8s.core.v1.Secret {
  const password = new RandomPassword(
    `${name}-db`,
    {
      length: 20,
      special: false,
      keepers: { name, username },
    },
    { parent },
  );

  return new k8s.core.v1.Secret(
    `${name}-db`,
    {
      metadata: {
        name: `${name}-db`,
        namespace,
        labels: {
          ...labels,
          'cnpg.io/reload': 'true',
        },
      },
      type: 'kubernetes.io/basic-auth',
      stringData: {
        username,
        password: password.result,
      },
    },
    { parent: password },
  );
}

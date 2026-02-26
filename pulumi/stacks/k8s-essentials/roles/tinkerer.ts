import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('tinker', {
  metadata: {
    name: 'tinker',
  },
});

const role = new k8s.rbac.v1.Role('tinkerer', {
  metadata: {
    name: 'tinkerer',
    namespace: namespace.metadata.name,
  },
  rules: [
    {
      apiGroups: ['*'],
      resources: ['*'],
      verbs: ['*'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tinkerer', {
  metadata: {
    name: 'tinkerer',
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'Role',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tinkerer',
    },
  ],
});

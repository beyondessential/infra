import * as k8s from '@pulumi/kubernetes';

export const serviceAccount = new k8s.core.v1.ServiceAccount('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
    namespace: 'tinker',
  },
});

const role = new k8s.rbac.v1.Role('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
    namespace: 'tinker',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['services'],
      verbs: ['get', 'list', 'watch', 'patch', 'update'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
    namespace: 'tinker',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'Role',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'ServiceAccount',
      name: serviceAccount.metadata.name,
      namespace: 'tinker',
    },
  ],
});

import * as k8s from '@pulumi/kubernetes';

export const serviceAccount = new k8s.core.v1.ServiceAccount('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
    namespace: 'tinker-system',
  },
});

const clusterRole = new k8s.rbac.v1.ClusterRole('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['services'],
      verbs: ['get', 'list', 'watch', 'patch', 'update'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: clusterRole.metadata.name,
  },
  subjects: [
    {
      kind: 'ServiceAccount',
      name: serviceAccount.metadata.name,
      namespace: 'tinker-system',
    },
  ],
});

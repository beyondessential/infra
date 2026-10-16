import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

export const serviceAccount = new k8s.core.v1.ServiceAccount('tinker-controller', {
  metadata: {
    namespace,
  },
});

const clusterRole = new k8s.rbac.v1.ClusterRole('tinker-controller', {
  rules: [
    {
      apiGroups: [''],
      resources: ['services'],
      verbs: ['get', 'list', 'watch', 'patch', 'update'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tinker-controller', {
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: clusterRole.metadata.name,
  },
  subjects: [
    {
      kind: 'ServiceAccount',
      name: serviceAccount.metadata.name,
      namespace,
    },
  ],
});

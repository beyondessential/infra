import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.js';

new k8s.rbac.v1.RoleBinding('edit', {
  metadata: {
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'edit',
  },
});

new k8s.rbac.v1.RoleBinding('read', {
  metadata: {
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'read',
  },
});

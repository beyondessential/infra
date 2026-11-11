import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

const subject = {
  apiGroup: 'rbac.authorization.k8s.io',
  kind: 'Group',
  name: 'tailscale:gha:canopy',
} as const;

new k8s.rbac.v1.RoleBinding('pgro-gha-canopy', {
  metadata: { namespace },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'cluster-admin',
  },
  subjects: [subject],
});

const nsClusterRole = new k8s.rbac.v1.ClusterRole('pgro-gha-canopy-ns', {
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('pgro-gha-canopy-ns', {
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: nsClusterRole.metadata.name,
  },
  subjects: [subject],
});

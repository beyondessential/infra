import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

const subject = { kind: 'Group', name: 'tailscale:gha:dagster' } as const;

// spec: DAGS#access
new k8s.rbac.v1.RoleBinding('gha-dagster', {
  metadata: { namespace },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'cluster-admin',
  },
  subjects: [{ apiGroup: 'rbac.authorization.k8s.io', ...subject }],
});

// Namespaces are cluster-scoped, so the RoleBinding above does not reach the
// namespace this stack manages. No delete.
// spec: DAGS#access
const nsClusterRole = new k8s.rbac.v1.ClusterRole('dagster-gha-ns', {
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('dagster-gha-ns', {
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: nsClusterRole.metadata.name,
  },
  subjects: [{ apiGroup: 'rbac.authorization.k8s.io', ...subject }],
});

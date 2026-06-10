import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

const subject = { kind: 'Group', name: 'tailscale:gha:canopy' } as const;

new k8s.rbac.v1.RoleBinding('gha-canopy', {
  metadata: {
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'cluster-admin',
  },
  subjects: [subject],
});

// Pulumi's Namespace resource is cluster-scoped, so it can't be reached by the
// in-namespace RoleBinding above. Grant just enough to refresh, create, and
// patch it — no delete, to keep the blast radius narrow.
const nsClusterRole = new k8s.rbac.v1.ClusterRole('tamanu-meta-gha-canopy-ns', {
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tamanu-meta-gha-canopy-ns', {
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: nsClusterRole.metadata.name,
  },
  subjects: [subject],
});

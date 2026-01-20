import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// Engineers need view access to metrics-system for prometheus data
new k8s.rbac.v1.RoleBinding('view-engineer', {
  metadata: {
    name: 'tamanu-view-engineer',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'view',
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-engineer',
    },
  ],
});

// Oncall also needs metrics access for troubleshooting
new k8s.rbac.v1.RoleBinding('view-oncall', {
  metadata: {
    name: 'tamanu-view-oncall',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'view',
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:oncall',
    },
  ],
});

import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// Engineers need view access to metrics-system to see pod stats, prometheus, etc.
new k8s.rbac.v1.RoleBinding('tamanu-engineer-view', {
  metadata: {
    name: 'tamanu-engineer-view',
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

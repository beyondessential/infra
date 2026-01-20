import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// Deployer needs read access to tamanu-system to read secrets and config templates
// that get copied into deployment namespaces
new k8s.rbac.v1.RoleBinding('tamanu-system-deploy-view', {
  metadata: {
    name: 'tamanu-deploy-view',
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
      name: 'tailscale:tamanu-deploy',
    },
  ],
});

// Engineers need write access to config templates and secrets
new k8s.rbac.v1.RoleBinding('tamanu-system-engineer', {
  metadata: {
    name: 'tamanu-engineer',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'tamanu-engineer',
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-engineer',
    },
  ],
});

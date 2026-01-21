import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// Deployer needs read access to tamanu-system to read secrets and config templates
// that get copied into deployment namespaces.
// Note: The built-in 'view' ClusterRole excludes secrets, so we need a custom role.
const deploySystemRole = new k8s.rbac.v1.Role('tamanu-deploy-system', {
  metadata: {
    name: 'tamanu-deploy-system',
    namespace,
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['secrets', 'configmaps'],
      verbs: ['get', 'list', 'watch'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tamanu-system-deploy', {
  metadata: {
    name: 'tamanu-deploy',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'Role',
    name: deploySystemRole.metadata.name,
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

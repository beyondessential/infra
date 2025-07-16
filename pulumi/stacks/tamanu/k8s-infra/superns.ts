import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('tamanu-super', {
  metadata: {
    name: 'tamanu-super',
  },
});

const createns = new k8s.rbac.v1.ClusterRole('createns', {
  metadata: {
    name: 'createns',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'create'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tailscale-deploy-createns', {
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: createns.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    }
  ],
});

new k8s.rbac.v1.RoleBinding('super-view', {
  metadata: {
    name: 'super:view',
    namespace: namespace.metadata.name,
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
    }
  ],
});

new k8s.rbac.v1.RoleBinding('super-edit', {
  metadata: {
    name: 'super:edit',
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'edit',
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    }
  ],
});

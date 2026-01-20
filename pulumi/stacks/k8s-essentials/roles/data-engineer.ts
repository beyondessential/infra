import * as k8s from '@pulumi/kubernetes';

const role = new k8s.rbac.v1.ClusterRole('data-engineer', {
  metadata: {
    name: 'data-engineer',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['pods', 'services', 'endpoints', 'namespaces'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: [''],
      resources: ['pods/portforward'],
      verbs: ['create'],
    },
    {
      apiGroups: [''],
      resources: ['pods/exec'],
      verbs: ['create'],
    },
    {
      apiGroups: [''],
      resources: ['secrets'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['clusters'],
      verbs: ['get', 'list', 'watch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('data-engineer', {
  metadata: {
    name: 'data-engineer',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:data-engineer',
    },
  ],
});

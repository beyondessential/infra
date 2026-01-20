import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../superns.ts';

const role = new k8s.rbac.v1.ClusterRole('tamanu-engineer', {
  metadata: {
    name: 'tamanu-engineer',
  },
  rules: [
    {
      apiGroups: [''],
      resources: [
        'pods',
        'pods/log',
        'services',
        'endpoints',
        'serviceaccounts',
        'persistentvolumeclaims',
        'events',
      ],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: [''],
      resources: ['configmaps', 'secrets'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: [''],
      resources: ['pods'],
      verbs: ['delete'],
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments', 'replicasets', 'statefulsets'],
      verbs: ['get', 'list', 'watch', 'update', 'patch'],
    },
    {
      apiGroups: ['batch'],
      resources: ['jobs', 'cronjobs'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: ['networking.k8s.io'],
      resources: ['ingresses'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['*'],
      verbs: ['get', 'list', 'watch'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tamanu-super-engineer', {
  metadata: {
    name: 'tamanu-engineer',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: role.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-engineer',
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tamanu-super-engineer-view', {
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

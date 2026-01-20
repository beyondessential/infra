import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../superns.ts';

// ClusterRole for creating namespaces and setting up HNC hierarchy.
// This needs to be cluster-scoped because:
// 1. Namespaces are cluster-level resources
// 2. HierarchyConfiguration must be created in the new namespace BEFORE
//    RoleBindings are propagated from the parent
const creatensRole = new k8s.rbac.v1.ClusterRole('tamanu-createns', {
  metadata: {
    name: 'tamanu-createns',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'create'],
    },
    {
      apiGroups: ['hnc.x-k8s.io'],
      resources: ['hierarchyconfigurations'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tamanu-deploy-createns', {
  metadata: {
    name: 'tamanu-deploy-createns',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: creatensRole.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    },
  ],
});

// Permissions needed for a tamanu/on-k8s deployment.
// Bound via RoleBinding in tamanu-super and propagated by HNC to child namespaces.
const deployRole = new k8s.rbac.v1.ClusterRole('tamanu-deploy', {
  metadata: {
    name: 'tamanu-deploy',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['secrets', 'configmaps', 'services', 'serviceaccounts'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: [''],
      resources: ['endpoints'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['batch'],
      resources: ['jobs'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['networking.k8s.io'],
      resources: ['ingresses'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['clusters', 'scheduledbackups'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tamanu-super-deploy', {
  metadata: {
    name: 'tamanu-deploy',
    namespace,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: deployRole.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    },
  ],
});

new k8s.rbac.v1.RoleBinding('tamanu-super-deploy-view', {
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

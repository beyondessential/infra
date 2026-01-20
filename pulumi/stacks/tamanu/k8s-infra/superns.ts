import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('tamanu-super', {
  metadata: {
    name: 'tamanu-super',
  },
});

// ClusterRole for creating namespaces and setting up HNC hierarchy.
// This needs to be cluster-scoped because:
// 1. Namespaces are cluster-level resources
// 2. HierarchyConfiguration must be created in the new namespace BEFORE
//    RoleBindings are propagated from the parent
const createns = new k8s.rbac.v1.ClusterRole('createns', {
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

new k8s.rbac.v1.ClusterRoleBinding('tailscale-deploy-createns', {
  metadata: {
    name: 'tamanu-deploy-createns',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: createns.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:tamanu-deploy',
    },
  ],
});

// ClusterRole defining all permissions needed for a Tamanu on-k8s deployment.
// This role is bound via RoleBinding in tamanu-super and propagated by HNC
// to child namespaces.
const deployRole = new k8s.rbac.v1.ClusterRole('tamanu-deploy', {
  metadata: {
    name: 'tamanu-deploy',
  },
  rules: [
    // Core resources needed for deployment
    {
      apiGroups: [''],
      resources: ['secrets', 'configmaps', 'services', 'serviceaccounts'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // For waiting on postgres endpoints
    {
      apiGroups: [''],
      resources: ['endpoints'],
      verbs: ['get', 'list', 'watch'],
    },
    // Deployments for api servers, web frontends, task runners
    {
      apiGroups: ['apps'],
      resources: ['deployments'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // Jobs for migrator and provisioner
    {
      apiGroups: ['batch'],
      resources: ['jobs'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // Ingresses for routing traffic
    {
      apiGroups: ['networking.k8s.io'],
      resources: ['ingresses'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // CNPG postgres clusters and backups
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['clusters', 'scheduledbackups'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
  ],
});

// RoleBinding in tamanu-super that will be propagated by HNC to child namespaces
new k8s.rbac.v1.RoleBinding('super-deploy', {
  metadata: {
    name: 'tamanu-deploy',
    namespace: namespace.metadata.name,
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

// Keep view for read access (useful for debugging/monitoring)
new k8s.rbac.v1.RoleBinding('super-view', {
  metadata: {
    name: 'tamanu-view',
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
    },
  ],
});

import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../superns.ts';

// spec: K8SNSP#tamanu-engineer
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
        'pods/exec',
        'pods/portforward',
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
      resources: ['pods/portforward', 'pods/exec'],
      verbs: ['create'],
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
      apiGroups: ['gateway.networking.k8s.io'],
      resources: ['gateways', 'httproutes'],
      verbs: ['get', 'list', 'watch'],
    },
    {
      apiGroups: ['gateway.envoyproxy.io'],
      resources: ['clienttrafficpolicies'],
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
      name: 'tailscale:engineer',
    },
    // TODO: delete after 2026-05-01 once the old group name is fully retired
    {
      kind: 'Group',
      name: 'tailscale:tamanu-engineer',
    },
  ],
});

// Cluster-level permissions for UI navigation and overview
// spec: K8SNSP#tamanu-engineer-cluster
const clusterRole = new k8s.rbac.v1.ClusterRole('tamanu-engineer-cluster', {
  metadata: {
    name: 'tamanu-engineer-cluster',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'watch'],
    },
    // Events view in Headlamp
    {
      apiGroups: [''],
      resources: ['events'],
      verbs: ['get', 'list', 'watch'],
    },
    // Cluster overview (CPU, memory stats)
    {
      apiGroups: [''],
      resources: ['nodes'],
      verbs: ['get', 'list', 'watch'],
    },
    // Node metrics for resource usage
    {
      apiGroups: ['metrics.k8s.io'],
      resources: ['nodes', 'pods'],
      verbs: ['get', 'list', 'watch'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tamanu-engineer-cluster', {
  metadata: {
    name: 'tamanu-engineer-cluster',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: clusterRole.metadata.name,
  },
  subjects: [
    {
      kind: 'Group',
      name: 'tailscale:engineer',
    },
    // TODO: delete after 2026-05-01 once the old group name is fully retired
    {
      kind: 'Group',
      name: 'tailscale:tamanu-engineer',
    },
  ],
});

import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../superns.ts';

// Minimal cluster-level permissions for namespace operations.
// With SubnamespaceAnchors, we only need to read namespaces (HNC creates them).
const clusterRole = new k8s.rbac.v1.ClusterRole('tamanu-deploy-cluster', {
  metadata: {
    name: 'tamanu-deploy-cluster',
  },
  rules: [
    {
      apiGroups: [''],
      resources: ['namespaces'],
      verbs: ['get', 'list', 'watch', 'patch'],
    },
    // VolumeSnapshotContents are cluster-scoped; we need to clone one pointing
    // at a seed snapshot's handle so CNPG can restore inside the deploy ns.
    {
      apiGroups: ['snapshot.storage.k8s.io'],
      resources: ['volumesnapshotcontents'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
  ],
});

new k8s.rbac.v1.ClusterRoleBinding('tamanu-deploy-cluster', {
  metadata: {
    name: 'tamanu-deploy-cluster',
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: clusterRole.metadata.name,
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
    // k[volumes.claim-by-deployer]
    {
      apiGroups: [''],
      resources: ['persistentvolumeclaims'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: [''],
      resources: ['endpoints'],
      verbs: ['get', 'list', 'watch'],
    },
    // Tamanu's CD fake data step runs the generator inside the central-api pod.
    {
      apiGroups: [''],
      resources: ['pods/exec'],
      verbs: ['create'],
    },
    {
      apiGroups: ['apps'],
      resources: ['deployments'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // tamanu/on-k8s gives each replicated workload a disruption budget.
    {
      apiGroups: ['policy'],
      resources: ['poddisruptionbudgets'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['policy'],
      resources: ['poddisruptionbudgets'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['batch'],
      resources: ['jobs', 'cronjobs'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['rbac.authorization.k8s.io'],
      resources: ['roles', 'rolebindings'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['networking.k8s.io'],
      resources: ['ingresses'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['postgresql.cnpg.io'],
      resources: ['clusters', 'scheduledbackups', 'backups'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['barmancloud.cnpg.io'],
      resources: ['objectstores'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // SubnamespaceAnchors for namespace lifecycle management.
    // Creating an anchor in tamanu-super causes HNC to create the child namespace.
    // Deleting the anchor cascades to delete the namespace.
    // This is safer than granting cluster-wide namespace delete permissions.
    {
      apiGroups: ['hnc.x-k8s.io'],
      resources: ['subnamespaceanchors'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['gateway.networking.k8s.io'],
      resources: ['gateways', 'httproutes'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    {
      apiGroups: ['gateway.envoyproxy.io'],
      resources: ['clienttrafficpolicies'],
      verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
    },
    // Namespace-scoped VolumeSnapshots in the deploy namespace, used as the
    // local handle for CNPG's volumeSnapshot recovery bootstrap.
    {
      apiGroups: ['snapshot.storage.k8s.io'],
      resources: ['volumesnapshots'],
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

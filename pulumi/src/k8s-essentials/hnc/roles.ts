// Converted from HNC v1.1.0 default-cm.yaml
import * as k8s from '@pulumi/kubernetes';
import { namespace, ns } from './namespace.js';

const leaderElectionRole = new k8s.rbac.v1.Role(
  'hnc-leader-election-role',
  {
    metadata: {
      name: 'hnc-leader-election-role',
      namespace,
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['configmaps'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      {
        apiGroups: [''],
        resources: ['configmaps/status'],
        verbs: ['get', 'update', 'patch'],
      },
      {
        apiGroups: [''],
        resources: ['events'],
        verbs: ['create'],
      },
    ],
  },
  { parent: ns },
);

export const adminRole = new k8s.rbac.v1.ClusterRole(
  'hnc-admin-role',
  {
    metadata: {
      labels: {
        'rbac.authorization.k8s.io/aggregate-to-admin': 'true',
      },
      name: 'hnc-admin-role',
    },
    rules: [
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['*'],
        verbs: ['*'],
      },
    ],
  },
  { parent: ns },
);

const managerRole = new k8s.rbac.v1.ClusterRole(
  'hnc-manager-role',
  {
    metadata: {
      creationTimestamp: 'null',
      name: 'hnc-manager-role',
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['resourcequotas'],
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['*'],
        resources: ['*'],
        verbs: ['*'],
      },
      {
        apiGroups: [''],
        resources: ['namespaces'],
        verbs: ['get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchicalresourcequotas'],
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchicalresourcequotas/status'],
        verbs: ['get', 'patch', 'update'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchies'],
        verbs: ['create', 'delete', 'get', 'list', 'patch', 'update', 'watch'],
      },
      {
        apiGroups: ['hnc.x-k8s.io'],
        resources: ['hierarchies/status'],
        verbs: ['get', 'patch', 'update'],
      },
    ],
  },
  { parent: ns },
);

new k8s.rbac.v1.RoleBinding(
  'hnc-leader-election-rolebinding',
  {
    metadata: {
      name: 'hnc-leader-election-rolebinding',
      namespace,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: leaderElectionRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: 'default',
        namespace,
      },
    ],
  },
  { parent: ns },
);

new k8s.rbac.v1.ClusterRoleBinding(
  'hnc-manager-rolebinding',
  {
    metadata: {
      name: 'hnc-manager-rolebinding',
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: managerRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: 'default',
        namespace,
      },
    ],
  },
  { parent: ns },
);

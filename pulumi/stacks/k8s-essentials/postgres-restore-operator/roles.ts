import * as k8s from '@pulumi/kubernetes';
import { namespace, ns } from './namespace.ts';

const serviceAccount = new k8s.core.v1.ServiceAccount(
  'postgres-restore-operator',
  {
    metadata: {
      name: 'postgres-restore-operator',
      namespace,
    },
  },
  { parent: ns },
);

const clusterRole = new k8s.rbac.v1.ClusterRole(
  'postgres-restore-operator',
  {
    metadata: {
      name: 'postgres-restore-operator',
    },
    rules: [
      // CRD access
      {
        apiGroups: ['bes.au'],
        resources: [
          'postgresphysicalreplicas',
          'postgresphysicalreplicas/status',
          'postgresphysicalrestores',
          'postgresphysicalrestores/status',
        ],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // Secrets (kopia credentials, analytics credentials)
      {
        apiGroups: [''],
        resources: ['secrets'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // Services (stable service per replica)
      {
        apiGroups: [''],
        resources: ['services'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // PVCs (restore data volumes)
      {
        apiGroups: [''],
        resources: ['persistentvolumeclaims'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // Jobs (restore jobs)
      {
        apiGroups: ['batch'],
        resources: ['jobs'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // Deployments (postgres instances)
      {
        apiGroups: ['apps'],
        resources: ['deployments'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // Events (for emitting Kubernetes events)
      {
        apiGroups: [''],
        resources: ['events'],
        verbs: ['create', 'patch'],
      },
      // Leader election
      {
        apiGroups: ['coordination.k8s.io'],
        resources: ['leases'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
    ],
  },
  { parent: ns },
);

new k8s.rbac.v1.ClusterRoleBinding(
  'postgres-restore-operator',
  {
    metadata: {
      name: 'postgres-restore-operator',
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'ClusterRole',
      name: clusterRole.metadata.name,
    },
    subjects: [
      {
        kind: 'ServiceAccount',
        name: serviceAccount.metadata.name,
        namespace,
      },
    ],
  },
  { parent: ns },
);

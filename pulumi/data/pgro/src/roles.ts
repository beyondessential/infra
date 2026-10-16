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
      // CRD install (operator applies its own CRDs on startup)
      {
        apiGroups: ['apiextensions.k8s.io'],
        resources: ['customresourcedefinitions'],
        verbs: ['get', 'list', 'create', 'update', 'patch'],
      },
      // CRD access
      {
        apiGroups: ['pgro.bes.au'],
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
      // Pods (reading Job pod termination messages for version detection, self-annotation)
      {
        apiGroups: [''],
        resources: ['pods'],
        verbs: ['get', 'list', 'patch', 'delete'],
      },
      // Namespaces (canopy-path replica namespaces are labelled + annotated by
      // the worklist syncer, and torn down when a declaration goes away)
      {
        apiGroups: [''],
        resources: ['namespaces'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // Pod logs (the tail of a failed migration Job, where the version under
      // test records no structured error of its own)
      {
        apiGroups: [''],
        resources: ['pods/log'],
        verbs: ['get'],
      },
      // Pod port-forward (overlay FDW reconciliation)
      {
        apiGroups: [''],
        resources: ['pods/portforward'],
        verbs: ['create'],
      },
      // Events (events.k8s.io/v1)
      {
        apiGroups: ['events.k8s.io'],
        resources: ['events'],
        verbs: ['create', 'patch'],
      },
      // CNPG Clusters (overlay database)
      {
        apiGroups: ['postgresql.cnpg.io'],
        resources: ['clusters'],
        verbs: ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete'],
      },
      // CNPG Image Catalogs (PG version discovery)
      {
        apiGroups: ['postgresql.cnpg.io'],
        resources: ['clusterimagecatalogs', 'imagecatalogs'],
        verbs: ['get', 'list'],
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

const configRole = new k8s.rbac.v1.Role(
  'postgres-restore-operator-config',
  {
    metadata: {
      name: 'postgres-restore-operator-config',
      namespace,
    },
    rules: [
      {
        apiGroups: [''],
        resources: ['configmaps'],
        resourceNames: ['postgres-restore-operator-config'],
        verbs: ['get', 'list', 'watch'],
      },
      // The Tailscale sidecar persists tailnet state in this Secret under the
      // operator's ServiceAccount, so a restart rejoins as the same node.
      {
        apiGroups: [''],
        resources: ['secrets'],
        resourceNames: ['pgro-operator-tailscale-state'],
        verbs: ['get', 'update', 'patch', 'create'],
      },
    ],
  },
  { parent: ns },
);

new k8s.rbac.v1.RoleBinding(
  'postgres-restore-operator-config',
  {
    metadata: {
      name: 'postgres-restore-operator-config',
      namespace,
    },
    roleRef: {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Role',
      name: configRole.metadata.name,
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

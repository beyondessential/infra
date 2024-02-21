import { readFileSync } from 'fs';
import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
await failIfIncorrectCluster();

const namespace = new k8s.core.v1.Namespace('tamanu-system', {
  metadata: {
    name: 'tamanu-system',
  },
});

new k8s.core.v1.ConfigMap('provisioning-basic', {
  metadata: {
    name: 'provisioning-template-basic',
    namespace: namespace.metadata.name,
    labels: {
      'bes.tamanu/template': 'provisioning',
    },
  },
  data: {
    'provisioning.json5': readFileSync('provisioning.json5', 'utf-8'),
  },
});

new k8s.core.v1.ConfigMap('config-central-basic', {
  metadata: {
    name: 'config-central-template-basic',
    namespace: namespace.metadata.name,
    labels: {
      'bes.tamanu/template': 'config-central',
    },
  },
  data: {
    'production.json5': readFileSync('central.json5', 'utf-8'),
  },
});

new k8s.core.v1.ConfigMap('config-facility-basic', {
  metadata: {
    name: 'config-facility-template-basic',
    namespace: namespace.metadata.name,
    labels: {
      'bes.tamanu/template': 'config-facility',
    },
  },
  data: {
    'production.json5.njk': readFileSync('facility.json5.njk', 'utf-8'),
  },
});

new k8s.rbac.v1.RoleBinding('edit', {
  metadata: {
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'edit',
  },
});

new k8s.rbac.v1.RoleBinding('read', {
  metadata: {
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'read',
  },
});

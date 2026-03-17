import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

// TODO: use the k8s-common code instead of doing this manually!!!!
export const dbCluster = new k8s.apiextensions.CustomResource('tinker-gateway-db', {
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Cluster',
  metadata: {
    name: 'tinker-db',
    namespace,
    labels: {
      'app.kubernetes.io/name': 'tinker-gateway',
      'app.kubernetes.io/component': 'database',
    },
    annotations: {
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    instances: 1,
    storage: {
      size: '5Gi',
    },
    affinity: {
      nodeSelector: {
        'bes.node.purpose': 'workload',
      },
    },
  },
});

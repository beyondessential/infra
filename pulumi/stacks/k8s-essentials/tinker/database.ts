import * as k8s from '@pulumi/kubernetes';
import { databaseName } from './config.ts';

export const dbCluster = new k8s.apiextensions.CustomResource('tinker-gateway-db', {
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Cluster',
  metadata: {
    name: databaseName,
    namespace: 'tinker-system',
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

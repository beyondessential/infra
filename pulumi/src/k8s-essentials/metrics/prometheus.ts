import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.js';

new k8s.helm.v3.Chart('prometheus', {
  repo: 'prometheus-community',
  chart: 'prometheus',
  version: '25.0.0',
  fetchOpts: {
    repo: 'https://prometheus-community.github.io/helm-charts',
  },
  namespace,
  values: {
    alertmanager: {
      enabled: false,
    },
    'prometheus-pushgateway': {
      enabled: false,
    },
    server: {
      replicaCount: 2,
      statefulSet: {
        enabled: true,
      },
      podAnnotations: {
        // 'consul.hashicorp.com/connect-inject': 'false',
      },
      persistentVolume: {
        size: '20Gi',
      },
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [{ key: 'bes.node.purpose', operator: 'In', values: ['system'] }],
              },
            ],
          },
        },
      },
    },
  },
});

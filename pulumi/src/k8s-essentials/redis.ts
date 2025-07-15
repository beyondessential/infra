import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg, clusterFullName } from '../common/k8s/coreRef.js';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../common/k8s/affinities.js';

const ns = new k8s.core.v1.Namespace('redis', {
  metadata: {
    name: 'redis-system',
  },
});

new k8s.helm.v3.Release('redis', {
  chart: 'redis-operator',
  version: '0.21.0',
  repositoryOpts: {
    repo: 'https://ot-container-kit.github.io/helm-charts/',
  },
  namespace: ns.metadata.name,
  values: {
    certmanager: {
      enabled: true,
    },
    redisOperator: {
      webhook: true,
      // what this does is unclear; it seems required for
      // securing redis deploys with TLS, and refuses to
      // install when certmanager is enabled and not this
    },
    issuer: {
      create: false,
      kind: 'ClusterIssuer',
      name: 'letsencrypt',
    },
    nodeSelector: {
      'kubernetes.io/os': 'linux',
    },
    tolerations: [CAN_RUN_ON_SPOT],
    affinity: {
      nodeAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 1,
            preference: RUN_ON_SPOT,
          },
        ],
      },
    },
  },
});

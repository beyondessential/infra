import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT, purposeAffinity } from '../common/k8s/affinities.js';

const namespace = new k8s.core.v1.Namespace('cert-manager', {
  metadata: {
    name: 'cert-manager',
  },
});

export const certManager = new k8s.helm.v3.Release('cert-manager', {
  chart: 'cert-manager',
  version: '1.14.2',
  repositoryOpts: {
    repo: 'https://charts.jetstack.io',
  },
  namespace: namespace.metadata.name,
  values: {
    installCRDs: true,
    replicaCount: 2,
    podDisruptionBudget: {
      enabled: true,
      minAvailable: 1,
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
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [purposeAffinity('ingress')],
            },
          ],
        },
      },
      podAntiAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [
                {
                  key: 'app.kubernetes.io/name',
                  operator: 'In',
                  values: ['cert-manager'],
                },
              ],
            },
            topologyKey: 'topology.kubernetes.io/zone',
          },
        ],
      },
    },
  },
});

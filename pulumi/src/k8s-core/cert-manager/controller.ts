import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.js';
import { RUN_ON_SPOT, purposeAffinity } from '../../common/k8s/affinities.js';
import { namespace } from './namespace.js';
import { sa } from './policy.js';
import { provider } from '../kubeconfig.js';

export const certManager = new k8s.helm.v3.Release('cert-manager', {
  chart: 'cert-manager',
  version: '1.14.2',
  repositoryOpts: {
    repo: 'https://charts.jetstack.io',
  },
  namespace,
  values: {
    installCRDs: true,
    replicaCount: 2,
    podDisruptionBudget: {
      enabled: true,
      minAvailable: 1,
    },
    serviceAccount: {
      create: false,
      name: sa.metadata.name,
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
}, { provider });

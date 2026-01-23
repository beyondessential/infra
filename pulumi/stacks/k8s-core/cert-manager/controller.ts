import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, purposeAffinity } from '../../common/k8s/affinities.ts';
import { namespace } from './namespace.ts';
import { sa } from './policy.ts';
import { provider } from '../kubeconfig.ts';

export const certManager = new k8s.helm.v3.Release(
  'cert-manager',
  {
    chart: 'cert-manager',
    version: '1.19.2',
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
  },
  { provider },
);

import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../common/k8s/affinities.js';

const ns = new k8s.core.v1.Namespace('ingress-system', {
  metadata: {
    name: 'ingress-system',
  },
});

new k8s.helm.v3.Release('nginx-ingress', {
  chart: 'ingress-nginx',
  version: '4.9.1',
  repositoryOpts: {
    repo: 'https://kubernetes.github.io/ingress-nginx',
  },
  namespace: ns.metadata.name,
  values: {
    controller: {
      replicaCount: 2,
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
                matchExpressions: [
                  { key: 'bes.node.purpose', operator: 'In', values: ['ingress'] },
                ],
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
                    values: ['ingress-nginx'],
                  },
                ],
              },
              topologyKey: 'topology.kubernetes.io/zone',
            },
          ],
        },
      },
      publishService: { enabled: true },
      service: {
        annotations: {
          'service.beta.kubernetes.io/aws-load-balancer-type': 'external',
          'service.beta.kubernetes.io/aws-load-balancer-nlb-target-type': 'ip',
          'service.beta.kubernetes.io/aws-load-balancer-ip-address-type': 'dualstack',
          'service.beta.kubernetes.io/aws-load-balancer-scheme': 'internet-facing',
        },
        ipFamilyPolicy: 'SingleStack',
        ipFamilies: ['IPv6'],
      },
    },
  },
}, { deleteBeforeReplace: true });

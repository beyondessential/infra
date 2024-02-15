import * as k8s from '@pulumi/kubernetes';

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
      affinity: {
        nodeAffinity: {
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
      },
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
});

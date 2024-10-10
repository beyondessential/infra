import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../common/k8s/affinities.js';
import { clusterName } from '../common/k8s/coreRef.js';

const ns = new k8s.core.v1.Namespace('ingress-system', {
  metadata: {
    name: 'ingress-system',
  },
});

new k8s.helm.v3.Release(
  'nginx-ingress',
  {
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
        config: {
          'allow-snippet-annotations': 'false',
          'enable-brotli': 'true',
          'enable-real-ip': 'true',
          'proxy-real-ip-cidr': '0.0.0.0/0,::/0',
          'use-proxy-protocol': 'true',
          'proxy-body-size': '50m',
        },
        publishService: { enabled: true },
        service: {
          annotations: {
            'service.beta.kubernetes.io/aws-load-balancer-type': 'external',
            'service.beta.kubernetes.io/aws-load-balancer-nlb-target-type': 'ip',
            'service.beta.kubernetes.io/aws-load-balancer-ip-address-type': 'dualstack',
            'service.beta.kubernetes.io/aws-load-balancer-scheme': 'internet-facing',
            'service.beta.kubernetes.io/aws-load-balancer-proxy-protocol': '*',
            'service.beta.kubernetes.io/aws-load-balancer-target-group-attributes':
              'preserve_client_ip.enabled=true',
            'service.beta.kubernetes.io/aws-load-balancer-attributes':
              'deletion_protection.enabled=true',
            'service.beta.kubernetes.io/aws-load-balancer-additional-resource-tags':
              clusterName.apply((clusterName) =>
                Object.entries({
                  Cluster: `k8s-${clusterName}`,
                  EKSCluster: clusterName,
                  Purpose: 'k8s-ingress',
                  'k8s:cluster-name': clusterName,
                })
                  .map(([k, v]) => `${k}=${v}`)
                  .join(','),
              ),
          },
          ipFamilyPolicy: 'SingleStack',
          ipFamilies: ['IPv6'],
        },
      },
    },
  },
  { deleteBeforeReplace: true },
);

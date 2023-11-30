import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('cnpg-system', {
  metadata: {
    name: 'cnpg-system',
  },
});

const cnpg = new k8s.helm.v3.Chart('cloudnative-pg', {
  repo: 'cnpg',
  chart: 'cloudnative-pg',
  version: '0.18.2',
  fetchOpts: {
    repo: 'https://cloudnative-pg.github.io/charts',
  },
  namespace: namespace.metadata.name,
  values: {
    podAnnotations: {
      // 'consul.hashicorp.com/connect-inject': 'false',
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
});

new k8s.core.v1.ConfigMap(
  'cnpg-controller-config',
  {
    metadata: {
      name: 'cnpg-controller-manager-config',
      namespace: namespace.metadata.name,
    },
    data: {
      INHERITED_ANNOTATIONS: 'consul.hashicorp.com/connect-inject*',
      INHERITED_LABELS: 'app.kubernetes.io/*',
    },
  },
  { dependsOn: [cnpg] },
);

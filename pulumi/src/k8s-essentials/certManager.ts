import * as k8s from '@pulumi/kubernetes';

const namespace = new k8s.core.v1.Namespace('cert-manager', {
  metadata: {
    name: 'cert-manager',
  },
});

export const certManager = new k8s.helm.v3.Release('cert-manager', {
  chart: 'cert-manager',
  version: '1.13.0',
  repositoryOpts: {
    repo: 'https://charts.jetstack.io',
  },
  namespace: namespace.metadata.name,
  values: {
    installCRDs: true,
    nodeSelector: {
      'bes.node.purpose': 'system',
    },
  },
});

import * as k8s from '@pulumi/kubernetes';

const ns = new k8s.core.v1.Namespace('tailscale', {
  metadata: {
    name: 'tailscale',
  },
});

new k8s.helm.v3.Release('tailscale', {
  chart: 'tailscale-operator',
  version: '1.58.2',
  repositoryOpts: {
    repo: 'https://pkgs.tailscale.com/helmcharts',
  },
  namespace: ns.metadata.name,
  values: {
    oauth: {
      clientId: '',
      clientSecret: '',
    },
    apiServerProxyConfig: {
      mode: 'true',
    },
  },
});

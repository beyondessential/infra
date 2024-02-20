import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg, clusterFullName } from '../common/k8s/coreRef.js';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../common/k8s/affinities.js';

const tailscaleEnabled = cfg.requireBoolean('tailscaleEnabled');
if (tailscaleEnabled) {
  const tailscaleClientId = cfg.require('tailscaleClientId');
  const tailscaleClientSecret = cfg.require('tailscaleClientSecret');

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
      operatorConfig: {
        logging: 'debug',
        hostname: interpolate`k8s-operator-${clusterFullName}`,
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
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    // ingress puts it in a public subnet, so it has a better network path
                    { key: 'bes.node.purpose', operator: 'In', values: ['ingress'] },
                  ],
                },
              ],
            },
          },
        },
      },
      oauth: {
        clientId: tailscaleClientId,
        clientSecret: tailscaleClientSecret,
      },
      apiServerProxyConfig: {
        mode: 'true',
      },
    },
  });
}

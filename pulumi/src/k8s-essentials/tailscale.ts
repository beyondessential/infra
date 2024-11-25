import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg, clusterFullName } from '../common/k8s/coreRef.js';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../common/k8s/affinities.js';

const tailscaleEnabled = cfg.getBoolean('tailscaleEnabled') ?? false;
if (tailscaleEnabled) {
  const tailscaleClientId = cfg.require('tailscaleClientId');
  const tailscaleClientSecret = cfg.require('tailscaleClientSecret');

  const ns = new k8s.core.v1.Namespace('tailscale', {
    metadata: {
      name: 'tailscale-system',
    },
  });

  new k8s.helm.v3.Release('tailscale', {
    chart: 'tailscale-operator',
    version: '1.76.6',
    repositoryOpts: {
      repo: 'https://pkgs.tailscale.com/helmcharts',
    },
    namespace: ns.metadata.name,
    values: {
      operatorConfig: {
        logging: 'debug',
        hostname: interpolate`k8s-operator-${clusterFullName}`,
        securityContext: {
          capabilities: {
            add: ['NET_ADMIN'],
          },
        },
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

  new k8s.apiextensions.CustomResource('exit-node', {
    metadata: {
      namespace: ns.metadata.name,
    },
    apiVersion: 'tailscale.com/v1alpha1',
    kind: 'Connector',
    spec: {
      hostname: interpolate`exit-k8s-${clusterFullName}`,
      tags: ['tag:server'],
      exitNode: true,
    },
  });
}

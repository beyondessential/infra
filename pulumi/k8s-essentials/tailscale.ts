import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { cfg, clusterFullName, tailscaleProxyDefaultTags } from '../common/k8s/coreRef.ts';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.ts';
import { RUN_ON_SPOT } from '../common/k8s/affinities.ts';
import { TAILSCALE_VERSION } from './versions.ts';

const tailscaleEnabled = cfg.getBoolean('tailscaleEnabled') ?? false;
if (tailscaleEnabled) {
  const tailscaleClientId = cfg.require('tailscaleClientId');
  // Two auth paths to the Tailscale API, preferring the legacy static-secret
  // path when configured so existing clusters keep working unchanged:
  //   - tailscaleClientSecret set  → static OAuth (legacy)
  //   - tailscaleAudience set      → workload identity federation; the
  //     operator pod mints an OIDC token from its service account against
  //     the cluster's OIDC issuer and exchanges it for a short-lived
  //     Tailscale API token. No long-lived secret stored.
  const tailscaleClientSecret = cfg.getSecret('tailscaleClientSecret');
  const tailscaleAudience = cfg.get('tailscaleAudience');
  if (!tailscaleClientSecret && !tailscaleAudience) {
    throw new Error(
      'tailscale: set either tailscaleClientSecret (legacy static OAuth) or tailscaleAudience (workload identity federation)',
    );
  }
  // Proxy tags are sourced from k8s-core (single source of truth, also read by
  // on-k8s); fall back to the unqualified defaults if k8s-core hasn't published
  // them yet.
  const proxyDefaultTags = tailscaleProxyDefaultTags.length
    ? tailscaleProxyDefaultTags
    : ['tag:k8s', 'tag:k8s-proxy'];
  const tailscaleOperatorDefaultTags: string[] = cfg.getObject('tailscaleOperatorDefaultTags') ?? [
    'tag:k8s-operator',
  ];

  const ns = new k8s.core.v1.Namespace('tailscale', {
    metadata: {
      name: 'tailscale-system',
    },
  });

  new k8s.helm.v3.Release('tailscale', {
    chart: 'tailscale-operator',
    version: TAILSCALE_VERSION,
    repositoryOpts: {
      repo: 'https://pkgs.tailscale.com/helmcharts',
    },
    namespace: ns.metadata.name,
    values: {
      proxyConfig: {
        defaultTags: proxyDefaultTags.join(','),
      },
      operatorConfig: {
        logging: 'debug',
        hostname: interpolate`k8s-operator-${clusterFullName}`,
        defaultTags: tailscaleOperatorDefaultTags.join(','),
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
      oauth: tailscaleClientSecret
        ? { clientId: tailscaleClientId, clientSecret: tailscaleClientSecret }
        : { clientId: tailscaleClientId, audience: tailscaleAudience },
      apiServerProxyConfig: {
        mode: 'true',
      },
    },
  });

  // After renaming, you need to go into the Tailscale admin console,
  // open the machine, go to change the machine name, switch off the
  // "auto generate from hostname" switch, don't actually change the
  // name, save, refresh the page, then go switch it back to generated
  // again, and that should pick up the new hostname defined here.
  const exitNodeName = cfg.get('tailscaleExitNodeName');
  if (exitNodeName) {
    // k[capacity.exit-node-dedicated]
    // Pin the exit node onto the dedicated `tailscale-exit` Karpenter pool
    // (k8s-core) and give it real resource requests. The operator otherwise
    // requests almost nothing (1m/1Mi), which would let Karpenter under-
    // provision; peak usage is ~0.2 vCPU / ~220MiB.
    const exitNodeProxyClass = new k8s.apiextensions.CustomResource('exit-node-proxyclass', {
      metadata: { name: 'exit-node' },
      apiVersion: 'tailscale.com/v1alpha1',
      kind: 'ProxyClass',
      spec: {
        statefulSet: {
          pod: {
            nodeSelector: { 'bes.node.purpose': 'tailscale-exit' },
            tolerations: [
              {
                key: 'bes.node.purpose',
                operator: 'Equal',
                value: 'tailscale-exit',
                effect: 'NoSchedule',
              },
            ],
            tailscaleContainer: {
              resources: {
                requests: { cpu: '250m', memory: '256Mi' },
              },
            },
          },
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
        hostname: exitNodeName,
        tags: ['tag:server'],
        exitNode: true,
        proxyClass: exitNodeProxyClass.metadata.name,
      },
    });
  }
}

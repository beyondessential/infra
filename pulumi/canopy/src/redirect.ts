import * as k8s from '@pulumi/kubernetes';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { TAILNET_DOMAIN } from '../../constants/internal.ts';

import { architecture, costLabels, tailscaleHostname } from './config.ts';
import { namespace } from './namespace.ts';

const CADDY_IMAGE = 'docker.io/library/caddy:2.11.4-alpine';
const PORT = 8080;

const labels = { app: 'meta', task: 'tailnet-redirect' };

/**
 * Answers every request with a permanent redirect to the canopy tailnet name.
 *
 * This exists to retire the historical `tamanu-meta-prod` tailnet name without
 * breaking links to it. It needs a workload rather than configuration because
 * the Tailscale operator, which owns that Ingress, implements neither the
 * ingress-nginx redirect annotations nor Gateway API — there is no way to
 * express a redirect on a tailnet Ingress without something to serve it.
 */
const config = new k8s.core.v1.ConfigMap('tailnet-redirect', {
  metadata: { namespace },
  data: {
    Caddyfile: [
      `:${PORT} {`,
      `\tredir https://${tailscaleHostname}.${TAILNET_DOMAIN}{uri} permanent`,
      '}',
      '',
    ].join('\n'),
  },
});

new k8s.apps.v1.Deployment('tailnet-redirect', {
  metadata: { namespace, labels },
  spec: {
    replicas: 1,
    selector: { matchLabels: labels },
    template: {
      metadata: { labels: { ...labels, ...costLabels } },
      spec: {
        tolerations: [CAN_RUN_ON_SPOT],
        affinity: {
          nodeAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 1, preference: RUN_ON_SPOT }],
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                { matchExpressions: [archAffinity(architecture), purposeAffinity('workload')] },
              ],
            },
          },
        },
        containers: [
          {
            name: 'caddy',
            image: CADDY_IMAGE,
            imagePullPolicy: 'IfNotPresent',
            args: ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
            ports: [{ containerPort: PORT, name: 'http' }],
            // Caddy insists on writable state and config directories even when
            // it is only serving redirects and never provisions a certificate.
            env: [
              { name: 'XDG_DATA_HOME', value: '/var/lib/caddy' },
              { name: 'XDG_CONFIG_HOME', value: '/var/lib/caddy' },
            ],
            volumeMounts: [
              { name: 'config', mountPath: '/etc/caddy', readOnly: true },
              { name: 'state', mountPath: '/var/lib/caddy' },
            ],
            resources: {
              requests: {
                cpu: '2m',
                memory: '16Mi',
              },
            },
            // A 301 counts as success: httpGet probes accept any 2xx or 3xx.
            readinessProbe: {
              httpGet: { path: '/', port: PORT, scheme: 'HTTP' },
            },
          },
        ],
        volumes: [
          { name: 'config', configMap: { name: config.metadata.name } },
          { name: 'state', emptyDir: {} },
        ],
      },
    },
  },
});

export const redirectSvc = new k8s.core.v1.Service('tailnet-redirect', {
  metadata: { namespace },
  spec: {
    selector: labels,
    ports: [
      {
        protocol: 'TCP',
        port: 80,
        targetPort: 'http',
        name: 'http',
      },
    ],
  },
});

import * as k8s from '@pulumi/kubernetes';
import { domains, replicas } from './config.ts';

import { namespace } from './namespace.ts';
import { caRootCert } from './ca.ts';
import { interpolate } from '@pulumi/pulumi';
import { labels } from './labels.ts';
import { migrator } from './jobs.ts';
import { spec } from './spec.ts';

const http = new k8s.core.v1.Service(
  'http',
  {
    metadata: {
      namespace,
    },
    spec: {
      ports: [
        {
          protocol: 'TCP',
          port: 80,
          targetPort: 'http',
          name: 'http',
        },
      ],
      selector: labels('server'),
    },
  },
  { replaceOnChanges: ['clusterIP'] },
);

new k8s.networking.v1.Ingress('http', {
  metadata: {
    namespace,
    name: 'meta',
    annotations: {
      'cert-manager.io/cluster-issuer': 'letsencrypt',
      'cert-manager.io/private-key-algorithm': 'ECDSA',
      'nginx.ingress.kubernetes.io/auth-tls-secret': interpolate`${caRootCert.metadata.namespace}/${caRootCert.metadata.name}`,
      'nginx.ingress.kubernetes.io/auth-tls-verify-client': 'optional_no_ca',
      'nginx.ingress.kubernetes.io/auth-tls-pass-certificate-to-upstream': 'true',
    },
  },
  spec: {
    ingressClassName: 'nginx',
    tls: [{ hosts: domains, secretName: 'http-tls' }],
    rules: domains.map((host) => ({
      host,
      http: {
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: {
              service: {
                name: http.metadata.name,
                port: {
                  name: 'http',
                },
              },
            },
          },
        ],
      },
    })),
  },
});

new k8s.apps.v1.Deployment(
  'server',
  {
    metadata: {
      labels: labels('server'),
      namespace,
    },
    spec: {
      replicas,
      selector: {
        matchLabels: labels('server'),
      },
      template: {
        metadata: {
          labels: labels('server'),
        },
        spec: spec('server', ['server', '--api-only'], {
          // Wait up to 60 seconds for the server to start...
          startupProbe: {
            periodSeconds: 1,
            failureThreshold: 60,
            httpGet: {
              path: '/servers',
              port: 8000,
              scheme: 'HTTP',
            },
          },
          // ...then continuously check if it's up, and restart if it fails
          livenessProbe: {
            periodSeconds: 10,
            failureThreshold: 2,
            httpGet: {
              path: '/servers',
              port: 8000,
              scheme: 'HTTP',
            },
          },
        }),
      },
    },
  },
  { dependsOn: [migrator] },
);

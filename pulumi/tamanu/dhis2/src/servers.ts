import * as k8s from '@pulumi/kubernetes';
import { domains, replicas } from './config.ts';

import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { spec } from './spec.ts';

const publicSvc = new k8s.core.v1.Service(
  'public-server',
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
      selector: labels('public'),
    },
  },
  { replaceOnChanges: ['clusterIP'] },
);

new k8s.networking.v1.Ingress('http', {
  metadata: {
    namespace,
    name: 'dhis2',
    annotations: {
      'cert-manager.io/cluster-issuer': 'letsencrypt',
      'cert-manager.io/private-key-algorithm': 'ECDSA',
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
                name: publicSvc.metadata.name,
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

new k8s.apps.v1.Deployment('public-server', {
  metadata: {
    labels: labels('public'),
    namespace,
  },
  spec: {
    replicas,
    selector: {
      matchLabels: labels('public'),
    },
    template: {
      metadata: {
        labels: labels('public'),
      },
      spec: spec('server', ['bash', '/config/startup.sh'], {
        // Wait up to 60 seconds for the server to start...
        startupProbe: {
          periodSeconds: 1,
          failureThreshold: 60,
          httpGet: {
            path: '/',
            port: 8080,
            scheme: 'HTTP',
          },
        },
        // // ...then continuously check if it's up, and restart if it fails
        livenessProbe: {
          periodSeconds: 10,
          failureThreshold: 2,
          httpGet: {
            path: '/',
            port: 8080,
            scheme: 'HTTP',
          },
        },
      }),
    },
  },
});

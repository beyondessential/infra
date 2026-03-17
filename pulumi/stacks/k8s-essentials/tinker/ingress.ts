import * as k8s from '@pulumi/kubernetes';
import { publicService } from './services.ts';

// t[impl dns.wildcard]
// t[impl tls.wildcard]
new k8s.networking.v1.Ingress('tinker-gateway', {
  metadata: {
    name: 'tinker-gateway',
    namespace: 'tinker-system',
    annotations: {
      'cert-manager.io/cluster-issuer': 'letsencrypt',
      'cert-manager.io/private-key-algorithm': 'ECDSA',
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    ingressClassName: 'nginx',
    tls: [
      {
        hosts: ['*.tinker.bes.au', 'tinker.bes.au'],
        secretName: 'tinker-gateway-tls',
      },
    ],
    rules: [
      {
        host: '*.tinker.bes.au',
        http: {
          paths: [
            {
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: publicService.metadata.name,
                  port: { number: 8080 },
                },
              },
            },
          ],
        },
      },
      {
        host: 'tinker.bes.au',
        http: {
          paths: [
            {
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: publicService.metadata.name,
                  port: { number: 8080 },
                },
              },
            },
          ],
        },
      },
    ],
  },
});

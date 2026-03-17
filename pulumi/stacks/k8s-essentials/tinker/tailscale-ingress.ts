import * as k8s from '@pulumi/kubernetes';
import { publicService } from './services.ts';

new k8s.networking.v1.Ingress('tinker-gateway-tailscale', {
  metadata: {
    name: 'tinker-gateway-tailscale',
    namespace: 'tinker',
    annotations: {
      'tailscale.com/hostname': 'tinker-gateway-detect',
      'tailscale.com/tags': 'tag:k8s,tag:tinker',
    },
  },
  spec: {
    ingressClassName: 'tailscale',
    tls: [{ hosts: ['tinker-gateway-detect'] }],
    rules: [
      {
        host: 'tinker-gateway-detect',
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

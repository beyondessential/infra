import * as k8s from '@pulumi/kubernetes';
import { publicService } from './services.ts';
import { gatewayTailscaleName } from './config.ts';

new k8s.networking.v1.Ingress('tinker-gateway-tailscale', {
  metadata: {
    namespace: 'tinker-system',
    annotations: {
      'tailscale.com/hostname': gatewayTailscaleName,
      'tailscale.com/tags': 'tag:k8s,tag:tinker',
    },
  },
  spec: {
    ingressClassName: 'tailscale',
    tls: [{ hosts: [gatewayTailscaleName] }],
    rules: [
      {
        host: gatewayTailscaleName,
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

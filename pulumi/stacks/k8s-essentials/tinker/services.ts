import * as k8s from '@pulumi/kubernetes';
import { gatewayLabels } from './labels.ts';

export const internalService = new k8s.core.v1.Service('tinker-gateway-internal', {
  metadata: {
    name: 'tinker-gateway-internal',
    namespace: 'tinker-system',
  },
  spec: {
    type: 'ClusterIP',
    selector: gatewayLabels,
    ports: [{ port: 8081, targetPort: 'internal', protocol: 'TCP', name: 'internal' }],
  },
});

export const publicService = new k8s.core.v1.Service('tinker-gateway-public', {
  metadata: {
    name: 'tinker-gateway-public',
    namespace: 'tinker-system',
  },
  spec: {
    type: 'ClusterIP',
    selector: gatewayLabels,
    ports: [{ port: 8080, targetPort: 'public', protocol: 'TCP', name: 'public' }],
  },
});

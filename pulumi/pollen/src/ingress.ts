import * as k8s from '@pulumi/kubernetes';
import { GATEWAY_CLASS_ENVOY } from '../../constants/internal.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../common/k8s/gateway/consts/API.ts';
import { Gateway } from '../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../common/k8s/gateway/HTTPRoute.ts';
import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { domain } from './config.ts';

export const service = new k8s.core.v1.Service(
  'pollen',
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
      selector: labels,
    },
  },
  { replaceOnChanges: ['clusterIP'] },
);

const gateway = Gateway('pollen', {
  metadata: {
    namespace,
    annotations: {
      'cert-manager.io/cluster-issuer': 'letsencrypt',
      'cert-manager.io/private-key-algorithm': 'ECDSA',
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    gatewayClassName: GATEWAY_CLASS_ENVOY,
    listeners: [
      {
        name: 'https',
        hostname: domain,
        port: 443,
        protocol: 'HTTPS',
        tls: {
          mode: 'Terminate',
          certificateRefs: [{ kind: 'Secret', name: 'pollen-termination-tls' }],
        },
      },
    ],
  },
});

HTTPRoute('pollen', {
  metadata: {
    namespace,
    annotations: {
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    parentRefs: [
      {
        group: GATEWAY_API_GROUP,
        kind: gateway.kind,
        namespace,
        name: gateway.metadata.name,
      },
    ],
    rules: [
      {
        backendRefs: [
          {
            namespace,
            name: service.metadata.name,
            port: 80,
          },
        ],
      },
    ],
  },
});

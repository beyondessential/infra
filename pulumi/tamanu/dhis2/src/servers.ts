import * as k8s from '@pulumi/kubernetes';
import { costLabels, domains, replicas } from './config.ts';

import { GATEWAY_CLASS_ENVOY } from '../../../constants/internal.ts';
import { Gateway } from '../../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../../common/k8s/gateway/HTTPRoute.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../../common/k8s/gateway/consts/API.ts';

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

const gateway = Gateway('http', {
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
    listeners: domains.map((hostname) => ({
      name: `${hostname}-public`,
      hostname,
      port: 443,
      protocol: 'HTTPS',
      tls: {
        mode: 'Terminate',
        certificateRefs: [{ kind: 'Secret', name: 'gateway-tls' }],
      },
    })),
  },
});

HTTPRoute('http', {
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
            name: publicSvc.metadata.name,
            port: 80,
          },
        ],
      },
    ],
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
          labels: { ...labels('public'), ...costLabels },
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

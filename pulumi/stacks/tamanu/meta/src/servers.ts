import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { domains, normalizedStack, publicServerVersionsSecret, replicas } from './config.ts';

import { GATEWAY_CLASS_ENVOY, TAILNET_DOMAIN } from '../../../constants/internal.ts';
import { Gateway } from '../../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../../common/k8s/gateway/HTTPRoute.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../../common/k8s/gateway/consts/API.ts';
import { FrontendValidationModeType } from '../../../common/k8s/gateway/consts/FrontendValidationModeType.ts';

import { namespace } from './namespace.ts';
import { caRootCert } from './ca.ts';
import { labels } from './labels.ts';
import { migrator } from './jobs.ts';
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
    tls: {
      frontend: {
        default: {
          validation: {
            // Issue a TLS CertificateRequest so clients can offer a cert,
            // but accept connections regardless of whether the cert is absent
            // or fails CA validation — equivalent to nginx's optional_no_ca.
            caCertificateRefs: [
              { group: '', kind: 'Secret', name: caRootCert.metadata.name, namespace },
            ],
            mode: FrontendValidationModeType.AllowInsecureFallback,
          },
        },
      },
    },
  },
  clientTrafficPolicyExtraSpec: {
    headers: {
      // Rewrite the x-forwarded-client-cert (XFCC) header with the client
      // certificate presented during the TLS handshake (if any).
      // The Cert field carries the full URL-encoded PEM certificate.
      xForwardedClientCert: {
        mode: 'SanitizeSet',
        certDetailsToAdd: ['Cert'],
      },
    },
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

new k8s.apps.v1.Deployment(
  'public-server',
  {
    metadata: {
      labels: labels('public'),
      namespace,
      name: 'public-server', // forces pulumi to not replace willy-nilly, so it stays up
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
        spec: spec('server', ['public-server'], {
          env: [
            {
              name: 'STATUS_PAGE_URL',
              value: `https://${normalizedStack}.${TAILNET_DOMAIN}/`,
            },
            {
              name: 'CLIENT_IP_SOURCE',
              value: 'RightmostXForwardedFor',
            },
            {
              name: 'SERVER_VERSIONS_SECRET',
              value: publicServerVersionsSecret,
            },
          ],
          // Wait up to 60 seconds for the server to start...
          startupProbe: {
            periodSeconds: 1,
            failureThreshold: 60,
            httpGet: {
              path: '/readyz',
              port: 8000,
              scheme: 'HTTP',
            },
          },
          // ...then continuously check if it's up, and restart if it fails
          livenessProbe: {
            periodSeconds: 10,
            failureThreshold: 2,
            httpGet: {
              path: '/livez',
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

const privateSvc = new k8s.core.v1.Service('private-server', {
  metadata: {
    namespace,
  },
  spec: {
    selector: labels('private'),
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

new k8s.networking.v1.Ingress('tailscale-server', {
  metadata: {
    namespace,
    annotations: {
      'tailscale.com/hostname': normalizedStack,
      'tailscale.com/tags': 'tag:tools,tag:server,tag:server-tamanu,tag:server-tamanu-meta',
    },
  },
  spec: {
    ingressClassName: 'tailscale',
    tls: [{ hosts: [normalizedStack] }],
    rules: [
      {
        host: normalizedStack,
        http: {
          paths: [
            {
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: privateSvc.metadata.name,
                  port: {
                    name: 'http',
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
});

new k8s.apps.v1.Deployment(
  'private-server',
  {
    metadata: {
      labels: labels('private'),
      namespace,
    },
    spec: {
      replicas,
      selector: {
        matchLabels: labels('private'),
      },
      template: {
        metadata: {
          labels: labels('private'),
        },
        spec: spec('server', ['private-server'], {
          env: [
            {
              name: 'PUBLIC_URL',
              value: `https://${domains[0]}`,
            },
            {
              name: 'CLIENT_IP_SOURCE',
              value: 'ConnectInfo',
            },
            {
              name: 'LEPTOS_OUTPUT_NAME',
              value: 'private-server',
            },
            {
              name: 'SERVER_VERSIONS_SECRET',
              value: publicServerVersionsSecret,
            },
          ],
          // Wait up to 60 seconds for the server to start...
          startupProbe: {
            periodSeconds: 1,
            failureThreshold: 60,
            httpGet: {
              path: '/readyz',
              port: 8000,
              scheme: 'HTTP',
            },
          },
          // ...then continuously check if it's up, and restart if it fails
          livenessProbe: {
            periodSeconds: 10,
            failureThreshold: 2,
            httpGet: {
              path: '/livez',
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

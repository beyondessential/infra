import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {
  costLabels,
  domains,
  normalizedStack,
  publicServerVersionsSecret,
  replicas,
  tailscaleClientId,
  tailscaleClientSecret,
  tailscaleHostname,
} from './config.ts';

import { GATEWAY_CLASS_ENVOY, TAILNET_DOMAIN, TAILNET_ID } from '../../constants/internal.ts';
import { Gateway } from '../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../common/k8s/gateway/HTTPRoute.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../common/k8s/gateway/consts/API.ts';

import { namespace } from './namespace.ts';
import { caRootCert } from './ca.ts';
import { labels } from './labels.ts';
import { sharedBackupsServerEnv } from './canopy-backups-shared.ts';
import { migrator } from './jobs.ts';
import { spec } from './spec.ts';
import { canopyIssuerSa, canopyPrivateSa } from './canopy-sa.ts';
import { recoveryKeysEnv } from './canopy-recovery.ts';
import { redirectSvc } from './redirect.ts';

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
      hostname: `gw.${hostname}`,
      port: 443,
      protocol: 'HTTPS',
      tls: {
        mode: 'Terminate',
        certificateRefs: [{ kind: 'Secret', name: 'gateway-tls' }],
      },
    })),
  },
  clientTrafficPolicyExtraSpec: {
    tls: {
      // Request a client cert during the TLS handshake but do not verify it
      // against any CA, and allow connections where no cert is presented —
      // equivalent to nginx's optional_no_ca.
      clientValidation: {
        optional: true,
      },
    },
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
          labels: { ...labels('public'), ...costLabels },
        },
        spec: spec(
          'server',
          ['public-server'],
          {
            env: [
              // Front-line API server: more concurrent DB work than the jobs,
              // so a larger pool than the crate's default. Stays well under the
              // cluster's max_connections across both replicas.
              {
                name: 'DB_MAX_OPEN_CONNECTIONS',
                value: '10',
              },
              {
                name: 'STATUS_PAGE_URL',
                value: `https://${tailscaleHostname}.${TAILNET_DOMAIN}/`,
              },
              {
                name: 'CLIENT_IP_SOURCE',
                value: 'RightmostXForwardedFor',
              },
              {
                name: 'SERVER_VERSIONS_SECRET',
                value: publicServerVersionsSecret,
              },
              ...sharedBackupsServerEnv,
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
          },
          { serviceAccountName: canopyIssuerSa },
        ),
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

// The historical tailnet name. It no longer serves the private server: it
// answers with a permanent redirect to the canopy name, ahead of going away.
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
                  name: redirectSvc.metadata.name,
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

new k8s.networking.v1.Ingress('tailscale-server-hostname', {
  metadata: {
    namespace,
    annotations: {
      'tailscale.com/hostname': tailscaleHostname,
      'tailscale.com/tags': 'tag:tools,tag:server,tag:server-tamanu,tag:server-tamanu-meta',
    },
  },
  spec: {
    ingressClassName: 'tailscale',
    tls: [{ hosts: [tailscaleHostname] }],
    rules: [
      {
        host: tailscaleHostname,
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
          labels: { ...labels('private'), ...costLabels },
        },
        spec: spec(
          'server',
          ['private-server'],
          {
            env: [
              // Front-line API server: more concurrent DB work than the jobs,
              // so a larger pool than the crate's default. Stays well under the
              // cluster's max_connections across both replicas.
              {
                name: 'DB_MAX_OPEN_CONNECTIONS',
                value: '10',
              },
              {
                name: 'PUBLIC_URL',
                value: `https://${domains[0]}`,
              },
              {
                name: 'CANOPY_MCP_ALLOWED_HOSTS',
                value: `${tailscaleHostname}.${TAILNET_DOMAIN}`,
              },
              {
                name: 'CLIENT_IP_SOURCE',
                value: 'RightmostXForwardedFor',
              },
              {
                name: 'SERVER_VERSIONS_SECRET',
                value: publicServerVersionsSecret,
              },
              {
                name: 'TAILSCALE_OAUTH_CLIENT_ID',
                value: tailscaleClientId,
              },
              {
                name: 'TAILSCALE_OAUTH_CLIENT_SECRET',
                value: tailscaleClientSecret,
              },
              {
                name: 'TAILSCALE_TAILNET',
                value: TAILNET_ID,
              },
              // For issuing the DR vault verification-ceremony age challenges.
              ...recoveryKeysEnv,
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
          },
          { serviceAccountName: canopyPrivateSa },
        ),
      },
    },
  },
  { dependsOn: [migrator] },
);

import { interpolate } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import {
  costLabels,
  domains,
  gatewayListeners,
  gatewayRouteDomains,
  maxRequestBody,
  nginxIngressEnabled,
  normalizedStack,
  publicServerVersionsSecret,
  replicas,
  requestTimeout,
  tailscaleClientId,
  tailscaleClientSecret,
  tailscaleHostname,
} from './config.ts';

import { GATEWAY_CLASS_ENVOY, TAILNET_DOMAIN, TAILNET_ID } from '../../constants/internal.ts';
import { Gateway } from '../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../common/k8s/gateway/HTTPRoute.ts';
import { BackendTrafficPolicy } from '../../common/k8s/gateway/BackendTrafficPolicy.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../common/k8s/gateway/consts/API.ts';

import { namespace } from './namespace.ts';
import { caRootCert } from './ca.ts';
import { labels } from './labels.ts';
import { acmeEnv } from './canopy-acme.ts';
import { artifactStoreEnv } from './canopy-artifacts.ts';
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
    listeners: gatewayListeners.map(({ name, hostname }) => ({
      name,
      hostname,
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
      // Request a client certificate during the handshake without verifying it,
      // and serve clients that present none — nginx's optional_no_ca. Client
      // certificates here are self-signed and authenticated by the backend,
      // which pins their public key, so there is no CA to validate against.
      //
      // `mode` requires Envoy Gateway 1.8 or newer. Its predecessor, `optional`,
      // could not express this: with no CA referenced Envoy never asked for a
      // certificate at all, and referencing one would have made it reject the
      // self-signed certificates it was sent (k[envoy.mtls-passthrough+2],
      // k[envoy.mtls-unverified]).
      clientValidation: {
        mode: 'Request',
      },
    },
    // Envoy buffers each request in full to enforce the size limit below, so the
    // connection buffer has to be sized for it; the default is 32KiB.
    connection: {
      bufferLimit: maxRequestBody,
    },
    headers: {
      // Rewrite the x-forwarded-client-cert (XFCC) header with the client
      // certificate presented during the TLS handshake (if any).
      // The Cert field carries the full URL-encoded PEM certificate.
      // k[envoy.mtls-header]
      xForwardedClientCert: {
        mode: 'SanitizeSet',
        certDetailsToAdd: ['Cert'],
      },
    },
  },
});

// k[envoy.body-size+2]
BackendTrafficPolicy('http', {
  metadata: { namespace },
  spec: {
    targetRefs: [
      {
        group: GATEWAY_API_GROUP,
        kind: gateway.kind,
        name: gateway.metadata.name,
      },
    ],
    requestBuffer: {
      limit: maxRequestBody,
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
    // Advertising a hostname here is what makes external-dns publish a record for
    // it, so which domains the route claims is what moves traffic onto the
    // Gateway — separately from which ones it is configured to serve
    // (k[migration.staging-alias]).
    hostnames: gatewayRouteDomains,
    rules: [
      {
        backendRefs: [
          {
            namespace,
            name: publicSvc.metadata.name,
            port: 80,
          },
        ],
        // k[envoy.timeouts+2]
        timeouts: {
          request: requestTimeout,
        },
      },
    ],
  },
});

// Deprecated: superseded by the Gateway above, and removed once envoyStage
// reaches `primary`. Its auth-tls-secret names a CA only because ingress-nginx
// will not request or forward a client certificate without one named; the
// certificates it forwards do not chain to it (k[envoy.mtls-unverified]).
if (nginxIngressEnabled) {
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
}

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
              // Artifact URLs and the RSS feed's link/guid are fetched later by
              // someone else, so the origin must be canonical rather than the
              // caller's own Host.
              {
                name: 'PUBLIC_URL',
                value: `https://${domains[0]}`,
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
              // Serves the bytes of a group-scoped artifact to the group it is
              // offered to. Must be the same bucket private-server registers into.
              ...artifactStoreEnv,
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
              // The settings panel reports the authority and whether the account
              // is usable, and reads that from here rather than from the pod
              // that does the ordering.
              ...acmeEnv,
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
              // Holds the bytes an operator uploads for a group, and drops them
              // again when the artifact is deregistered.
              ...artifactStoreEnv,
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

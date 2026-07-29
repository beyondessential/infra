import { GATEWAY_CLASS_ENVOY } from '../../../../constants/internal.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../../../common/k8s/gateway/consts/API.ts';
import { HTTPRouteFilterType } from '../../../../common/k8s/gateway/consts/HTTPRouteFilterType.ts';
import { Gateway } from '../../../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../../../common/k8s/gateway/HTTPRoute.ts';

import { namespace } from '../namespace.ts';

const MOVED_PERMANENTLY = 301;

/** Hostnames are valid listener names, but not valid Pulumi/k8s resource names. */
const slug = (host: string) => host.replaceAll('.', '-');

/**
 * Serve retired hostnames with nothing but a permanent redirect to whatever
 * replaced them.
 *
 * One Gateway carries a listener per hostname, which is what makes external-dns
 * publish the records and cert-manager issue the certificates — the same path any
 * other listener takes. Envoy Gateway merges gateways onto its shared proxy
 * deployment, so each redirect costs a listener and a certificate rather than a
 * proxy of its own.
 *
 * Each route declares its own hostname: routes attached to a multi-listener
 * Gateway without one would apply to every listener, so every hostname would
 * redirect to the same place.
 */
export function redirectSites(redirects: Record<string, string>) {
  const hosts = Object.keys(redirects).sort();
  if (hosts.length === 0) {
    return;
  }

  const gateway = Gateway('redirects', {
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
      listeners: hosts.map((host) => ({
        name: host,
        hostname: host,
        port: 443,
        protocol: 'HTTPS',
        tls: {
          mode: 'Terminate',
          certificateRefs: [{ kind: 'Secret', name: 'redirects-termination-tls' }],
        },
      })),
    },
  });

  for (const host of hosts) {
    const target = new URL(redirects[host]);
    if (target.pathname !== '/' && target.pathname !== '') {
      // The redirect preserves the request path, so a target path would be
      // silently dropped. Fail rather than mislead.
      throw new Error(`Redirect target for ${host} must not have a path: ${redirects[host]}`);
    }

    HTTPRoute(`redirect-${slug(host)}`, {
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
        hostnames: [host],
        rules: [
          {
            filters: [
              {
                type: HTTPRouteFilterType.RequestRedirect,
                requestRedirect: {
                  scheme: target.protocol.replace(/:$/, ''),
                  hostname: target.hostname,
                  statusCode: MOVED_PERMANENTLY,
                },
              },
            ],
          },
        ],
      },
    });
  }
}

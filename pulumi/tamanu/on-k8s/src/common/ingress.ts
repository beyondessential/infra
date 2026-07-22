import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

import { GATEWAY_CLASS_ENVOY } from '../../../../constants/internal.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../../../common/k8s/gateway/consts/API.ts';
import { Gateway } from '../../../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../../../common/k8s/gateway/HTTPRoute.ts';
import type { HTTPRouteTimeouts } from '../../../../common/k8s/gateway/interfaces/HTTPRouteTimeouts.ts';

import { namespace } from '../namespace.ts';

export interface IngressArgs {
  name: string;
  parent: ComponentResource;
  host: string;
  api: k8s.core.v1.Service;
  web: k8s.core.v1.Service;
}

export function ingress({ name, host, api, web, parent }: IngressArgs) {
  const gateway = Gateway(
    name,
    {
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
            name,
            hostname: host,
            port: 443,
            protocol: 'HTTPS',
            tls: {
              mode: 'Terminate',
              certificateRefs: [{ kind: 'Secret', name: `${name}-termination-tls` }],
            },
          },
        ],
      },
    },
    { parent },
  );

  const route = (
    routeName: string,
    path: string,
    backend: k8s.core.v1.Service,
    timeouts?: HTTPRouteTimeouts,
  ): k8s.apiextensions.CustomResource =>
    HTTPRoute(
      `${name}-${routeName}`,
      {
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
              matches: [
                {
                  path: {
                    value: path,
                  },
                },
              ],
              backendRefs: [
                {
                  namespace,
                  name: backend.metadata.name,
                  port: 80,
                },
              ],
              ...(timeouts && { timeouts }),
            },
          ],
        },
      },
      { parent },
    );

  route('frontend', '/', web);
  route('api', '/api', api);
  route('api-legacy', '/v1', api);
  // Data imports run synchronously within a single request, so large files
  // exceed Envoy's default 15s route timeout (k[envoy.timeouts]). Longest
  // path prefix wins, so these take precedence over the /api and /v1 routes.
  route('api-import', '/api/admin/import', api, { request: '600s' });
  route('api-import-legacy', '/v1/admin/import', api, { request: '600s' });

  return gateway;
}

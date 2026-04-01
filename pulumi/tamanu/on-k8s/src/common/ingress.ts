import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

import { GATEWAY_CLASS_ENVOY } from '../../../../constants/internal.ts';
import { API_GROUP as GATEWAY_API_GROUP } from '../../../../common/k8s/gateway/consts/API.ts';
import { Gateway } from '../../../../common/k8s/gateway/Gateway.ts';
import { HTTPRoute } from '../../../../common/k8s/gateway/HTTPRoute.ts';

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
            },
          ],
        },
      },
      { parent },
    );

  route('frontend', '/', web);
  route('api', '/api', api);
  route('api-legacy', '/v1', api);

  return gateway;
}

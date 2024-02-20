import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';

export interface IngressArgs {
  name: string;
  parent: ComponentResource;
  host: string;
  api: k8s.core.v1.Service;
  web: k8s.core.v1.Service;
}

export function ingress({ name, host, api, web, parent }: IngressArgs) {
  return new k8s.networking.v1.Ingress(
    name,
    {
      metadata: {
        namespace,
        name,
      },
      spec: {
        ingressClassName: 'nginx',
        rules: [
          {
            host,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: web.metadata.name,
                      port: {
                        name: 'http',
                      },
                    },
                  },
                },
                {
                  path: '/api',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: api.metadata.name,
                      port: {
                        name: 'http',
                      },
                    },
                  },
                },
                {
                  path: '/v1',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: api.metadata.name,
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
    },
    { parent },
  );
}

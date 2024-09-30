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

function compact<T>(obj: Array<T | undefined>): Array<T> {
  return obj.filter(Boolean) as Array<T>;
}

export function ingress({ name, host, api, web, parent }: IngressArgs) {
  const route = (path: string, backend: k8s.core.v1.Service): k8s.types.input.networking.v1.HTTPIngressPath => ({
    path,
    pathType: 'Prefix',
    backend: {
      service: {
        name: backend.metadata.name,
        port: {
          name: 'http',
        },
      },
    },
  });

  return new k8s.networking.v1.Ingress(
    name,
    {
      metadata: {
        namespace,
        name,
        annotations: {
          'cert-manager.io/cluster-issuer': 'letsencrypt',
          'cert-manager.io/private-key-algorithm': 'ECDSA',

          // for websocket
          'nginx.ingress.kubernetes.io/proxy-read-timeout': '3600',
          'nginx.ingress.kubernetes.io/proxy-send-timeout': '3600',
        },
      },
      spec: {
        ingressClassName: 'nginx',
        tls: [{ hosts: [host], secretName: `${name}-tls` }],
        rules: [
          {
            host,
            http: {
              paths: compact([
                route('/', web),
                route('/api', api),
                route('/v1', api),
                route('/socket.io', api),
              ]),
            },
          },
        ],
      },
    },
    { parent },
  );
}

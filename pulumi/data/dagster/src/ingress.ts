import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { name } from './config.ts';
import { releaseName } from './helm.ts';

// The chart names the webserver Service `<release>-dagster-webserver`.
const webserverServiceName = `${releaseName}-dagster-webserver`;

// spec: DAGS#access
new k8s.networking.v1.Ingress('tailscale', {
  metadata: {
    namespace,
    annotations: {
      'tailscale.com/hostname': name,
      'tailscale.com/tags': 'tag:tools-dagster',
    },
  },
  spec: {
    ingressClassName: 'tailscale',
    tls: [{ hosts: [name] }],
    rules: [
      {
        host: name,
        http: {
          paths: [
            {
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: webserverServiceName,
                  port: { name: 'http' },
                },
              },
            },
          ],
        },
      },
    ],
  },
});

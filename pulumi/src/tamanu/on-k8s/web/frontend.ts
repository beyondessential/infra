import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { ServerType, appLabels, appSelector } from './specs.js';
import { PodSpecFactory } from '../common/specFactory.js';

export interface RunWebArgs {
  parent: ComponentResource;
  serverType: ServerType;
  podSpec: PodSpecFactory;
  replicas?: number;
  instance?: string;
}

export interface RunWebOutput {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
}

export function runWeb(
  name: string,
  { parent, serverType, podSpec, replicas = 1, instance }: RunWebArgs,
): RunWebOutput {
  const service = new k8s.core.v1.Service(
    `${name}-web`,
    {
      metadata: {
        namespace,
        name: `${name}-web`,
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
        selector: appSelector(serverType, instance),
        clusterIP: 'None',
      },
    },
    { parent, replaceOnChanges: ['clusterIP'] },
  );

  const deployment = new k8s.apps.v1.Deployment(
    `${name}-web`,
    {
      metadata: {
        namespace,
      },
      spec: {
        replicas,
        selector: {
          matchLabels: appSelector(serverType, instance),
        },
        template: {
          metadata: {
            labels: appLabels(serverType, instance),
          },
          spec: podSpec({
            podType: 'http',
            podSpreadSelector: appSelector(serverType, instance),
            containerArgs: {
              ports: [
                {
                  containerPort: 3000,
                  name: 'http',
                },
              ],
              // Wait up to 60 seconds for the server to start...
              startupProbe: {
                periodSeconds: 1,
                failureThreshold: 60,
                httpGet: {
                  path: '/',
                  port: 3000,
                },
              },
              // ...then continuously check if it's up, and restart if it fails
              livenessProbe: {
                periodSeconds: 10,
                failureThreshold: 2,
                httpGet: {
                  path: '/',
                  port: 3000,
                },
              },
            },
          }),
        },
      },
    },
    { parent },
  );

  return { service, deployment };
}

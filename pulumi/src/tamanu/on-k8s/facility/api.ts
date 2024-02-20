import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { PodSpecFactory, appLabels, appSelector } from './specs.js';

export interface RunApiArgs {
  parent: ComponentResource;
  deviceId: string;
  replicas?: number;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
}

export interface RunApiOutput {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
}

export function runApi(
  name: string,
  { parent, deviceId, replicas = 1, podSpec, migratorJob }: RunApiArgs,
): RunApiOutput {
  const service = new k8s.core.v1.Service(
    `facility-${name}-api`,
    {
      metadata: {
        namespace,
        name: `facility-${name}-api`,
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
        selector: appSelector('server', deviceId),
        clusterIP: 'None',
      },
    },
    { parent, dependsOn: [migratorJob], replaceOnChanges: ['clusterIP'] },
  );

  const deployment = new k8s.apps.v1.Deployment(
    `facility-${name}-api`,
    {
      metadata: {
        namespace,
        name: `facility-${name}-api`,
      },
      spec: {
        replicas,
        selector: {
          matchLabels: appSelector('server', deviceId),
        },
        template: {
          metadata: {
            labels: appLabels('server', deviceId),
          },
          spec: podSpec('server', ['serve'], {
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
          }),
        },
      },
    },
    { parent, dependsOn: [migratorJob] },
  );

  return { service, deployment };
}

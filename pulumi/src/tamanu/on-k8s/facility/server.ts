import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { appLabels, appSelector } from './specs.js';
import { PodSpecFactory } from '../common/specFactory.js';

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

export function runServer(
  name: string,
  type: 'api' | 'sync',
  { parent, deviceId, replicas = 1, podSpec, migratorJob }: RunApiArgs,
): RunApiOutput {
  const command = type === 'api' ? 'startApi' : 'startSync';

  const service = new k8s.core.v1.Service(
    `facility-${name}-${type}`,
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
        selector: appSelector(`${type}-server`, deviceId),
        clusterIP: 'None',
      },
    },
    { parent, dependsOn: [migratorJob], replaceOnChanges: ['clusterIP'] },
  );

  const deployment = new k8s.apps.v1.Deployment(
    `facility-${name}-${type}`,
    {
      metadata: {
        namespace,
        name: `facility-${name}-${type}`,
      },
      spec: {
        replicas,
        strategy: {
          type: type === 'api' ? 'RollingUpdate' : 'Recreate',
        },
        selector: {
          matchLabels: appSelector(`${type}-server`, deviceId),
        },
        template: {
          metadata: {
            labels: appLabels(`${type}-server`, deviceId),
          },
          spec: podSpec({
            podType: 'server',
            podSpreadSelector: appLabels(`${type}-server`, deviceId),
            command: [command],
            env: [{ name: 'PORT', value: '3000' }],
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
    { parent, dependsOn: [migratorJob] },
  );

  return { service, deployment };
}

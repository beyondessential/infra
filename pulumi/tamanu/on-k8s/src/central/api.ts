import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import { costLabels, syntheticTests } from '../config.ts';
import { appLabels, appSelector } from './specs.ts';
import type { PodSpecFactory } from '../common/specFactory.ts';
import { replicaDisruptionBudget } from '../common/scheduling.ts';

export interface RunApiArgs {
  parent: ComponentResource;
  replicas: number;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
  provisionerJob: k8s.batch.v1.Job;
}

export interface RunApiOutput {
  deployment: k8s.apps.v1.Deployment;
  service: k8s.core.v1.Service;
}

export function runApi({
  parent,
  replicas,
  podSpec,
  migratorJob,
  provisionerJob,
}: RunApiArgs): RunApiOutput {
  const service = new k8s.core.v1.Service(
    'central-api',
    {
      metadata: {
        namespace,
        name: 'central-api',
      },
      spec: {
        // prefer same-zone endpoints; cross-AZ traffic is billed
        trafficDistribution: 'PreferClose',
        ports: [
          {
            protocol: 'TCP',
            port: 80,
            targetPort: 'http',
            name: 'http',
          },
        ],
        selector: appSelector('api-server'),
      },
    },
    { parent, replaceOnChanges: ['clusterIP'] },
  );

  const deployment = new k8s.apps.v1.Deployment(
    'central-api',
    {
      metadata: {
        namespace,
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        replicas,
        selector: {
          matchLabels: appSelector('api-server'),
        },
        template: {
          metadata: {
            labels: { ...appLabels('api-server'), ...costLabels },
          },
          spec: podSpec({
            podType: 'server',
            podSpreadSelector: appLabels('api-server'),
            command: ['serve'],
            env: [
              { name: 'PORT', value: '3000' },
              ...(syntheticTests ? [{ name: 'TAMANU_ENABLE_SYNTHETIC_RANDOM_API', value: 'true' }] : []),
            ],
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
    { parent, dependsOn: [migratorJob, provisionerJob] },
  );

  replicaDisruptionBudget('central-api', appSelector('api-server'), parent);

  return { service, deployment };
}

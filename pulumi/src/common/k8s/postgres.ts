import { ComponentResource, Input, Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sWaitFor } from './waitFor.js';
import { CAN_RUN_ON_SPOT } from './tolerations.js';
import { RUN_ON_SPOT } from './affinities.js';
import { postgresUrlSecret } from './postgresUrl.js';

export interface PostgresArgs {
  parent: ComponentResource;
  namespace: Input<string>;
  name: Input<string>;
  replicas: Input<number>;
  storage: Input<string>;
  timezone: Input<string>;
}

export type PostgresReady = Output<void>;

export function runPostgres({
  parent,
  namespace,
  name,
  replicas,
  storage,
  timezone,
}: PostgresArgs): PostgresReady {
  new k8s.apiextensions.CustomResource(
    `${name}-db`,
    {
      apiVersion: 'postgresql.cnpg.io/v1',
      kind: 'Cluster',
      metadata: {
        name: `${name}-db`,
        namespace,
        labels: {
          'app.kubernetes.io/name': name,
          'app.kubernetes.io/component': 'database',
        },
      },
      spec: {
        instances: replicas,
        primaryUpdateStrategy: 'unsupervised',
        storage: {
          size: storage,
        },
        env: [
          {
            name: 'TZ',
            value: timezone,
          },
        ],
        resources: {
          requests: {
            memory: '750Mi',
            cpu: '10m',
          },
        },
        postgresql: {
          parameters: {
            // should be about 25% of requested memory
            shared_buffers: '200MB',
          },
        },
        affinity: {
          nodeSelector: {
            'bes.node.purpose': 'workload',
          },
          tolerations: [CAN_RUN_ON_SPOT],
          nodeAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [
              {
                weight: 1,
                preference: RUN_ON_SPOT,
              },
            ],
          },
        },
      },
    },
    { parent },
  );

  const dbReady = k8sWaitFor(
    `${name}-db`,
    async (kc, namespace) => {
      const k8sApi = kc.makeApiClient(CoreV1Api);
      const endpoint = await k8sApi.readNamespacedEndpoints(`${name}-db-rw`, namespace);
      const readyAddresses = endpoint?.body?.subsets?.[0]?.addresses ?? [];
      if (readyAddresses.length === 0) {
        throw new Error('No ready addresses');
      }
    },
    namespace,
  );
  postgresUrlSecret({ parent, namespace, name, dbReady });
  return dbReady;
}

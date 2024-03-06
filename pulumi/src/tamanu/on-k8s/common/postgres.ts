import { ComponentResource, Input, Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sWaitFor } from '../../../common/k8s/waitFor.js';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../../../common/k8s/affinities.js';
import { namespace } from '../namespace.js';
import { architecture } from '../config.js';
import { postgresUrlSecret } from './postgresUrl.js';

export interface PostgresArgs {
  parent: ComponentResource;
  name: string;
  replicas: Input<number>;
  storage: Input<string>;
  timezone: Input<string>;
}

export type PostgresReady = Output<void>;

export function runPostgres({
  parent,
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
            memory: '250m',
            cpu: '100m',
          },
        },
        affinity: {
          nodeSelector: {
            // Because we colocate the databases with their servers, we stick
            // to the same architecture, until we can build for arm64.
            'bes.node.arch': architecture,
            'bes.node.purpose': 'workload',
          },
          additionalPodAntiAffinity: {
            // spread out the database pods across AZs
            preferredDuringSchedulingIgnoredDuringExecution: [
              {
                weight: 20,
                podAffinityTerm: {
                  topologyKey: 'topology.kubernetes.io/zone',
                  labelSelector: {
                    matchExpressions: [
                      {
                        key: 'namespace',
                        operator: 'In',
                        values: [namespace],
                      },
                      {
                        key: 'app.kubernetes.io/component',
                        operator: 'In',
                        values: ['database'],
                      },
                    ],
                  },
                },
              },
            ],
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
  postgresUrlSecret({ parent, name, dbReady });
  return dbReady;
}

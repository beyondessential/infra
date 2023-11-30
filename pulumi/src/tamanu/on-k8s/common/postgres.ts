import { ComponentResource, Input, Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sWaitFor } from '../../../common/k8s/waitFor.js';
import { namespace } from '../namespace.js';

export interface PostgresArgs {
  parent: ComponentResource;
  name: string;
  replicas: Input<number>;
  storage: Input<string>;
  timezone: Input<string>;
  affinities?: PostgresAffinities;
}

export type PostgresReady = Output<void>;

export interface PostgresAffinities {
  nodeSelector?: Input<{
    [key: string]: Input<string>;
  }>;
  tolerations?: Input<Input<k8s.types.input.core.v1.Toleration>[]>;
  nodeAffinity?: Input<k8s.types.input.core.v1.NodeAffinity>;
  additionalPodAffinity?: Input<k8s.types.input.core.v1.PodAffinity>;
  additionalPodAntiAffinity?: Input<k8s.types.input.core.v1.PodAntiAffinity>;
}

export function runPostgres({
  parent,
  name,
  replicas,
  storage,
  timezone,
  affinities,
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
          ...affinities,
          nodeSelector: {
            ...affinities?.nodeSelector,
            'bes.node.purpose': 'workload',
          },
        },
      },
    },
    { parent },
  );

  return k8sWaitFor(
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
}

import { Output, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { PostgresReady } from '../common/postgres.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.js';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';
import { PodSpecFactory, PodSpecArgs, podSpreadAntiAffinity } from '../common/specFactory.js';
import { namespace } from '../namespace.js';
import { architecture } from '../config.js';
import { image, imageTag } from '../image.js';

export function appSelector(component: string, deviceId: string): { [key: string]: string } {
  return {
    'app.kubernetes.io/name': 'facility',
    'app.kubernetes.io/component': component,
    'app.kubernetes.io/instance': deviceId,
  };
}

export function appLabels(component: string, deviceId: string): { [key: string]: string } {
  return {
    ...appSelector(component, deviceId),
    'app.kubernetes.io/version': imageTag,
  };
}

export interface PodSpecFactoryArgs {
  name: string;
  timezone: string;
  appConfig: Output<string>;
  dbReady: PostgresReady;
}

export function podSpecFactory({
  name,
  timezone,
  appConfig,
  dbReady,
}: PodSpecFactoryArgs): PodSpecFactory {
  return ({
    podType,
    podSpreadSelector,
    command,
    containerArgs: { volumeMounts = [], ...containerArgs } = {},
    volumes = [],
  }: PodSpecArgs): k8s.types.input.core.v1.PodSpec => ({
    tolerations: [CAN_RUN_ON_SPOT],
    affinity: {
      nodeAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 1,
            preference: RUN_ON_SPOT,
          },
        ],
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
            },
          ],
        },
      },
      // Co-locate the facility server pod with its database when possible
      podAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 100,
            podAffinityTerm: {
              topologyKey: 'kubernetes.io/hostname',
              labelSelector: {
                matchExpressions: [
                  {
                    key: 'namespace',
                    operator: 'In',
                    values: [namespace],
                  },
                  {
                    key: 'name',
                    operator: 'In',
                    values: [`facility-${name}-db`],
                  },
                ],
              },
            },
          },
        ],
      },
      podAntiAffinity: podSpreadAntiAffinity(podSpreadSelector),
    },
    volumes: [
      {
        name: 'config-volume',
        configMap: {
          name: appConfig,
        },
      },
      ...volumes,
    ],
    imagePullSecrets: [{name: 'pullsecret-github'}],
    containers: [
      {
        name: podType,
        image: image('facility'),
        imagePullPolicy: 'IfNotPresent',
        args: command,
        volumeMounts: output(volumeMounts).apply((vms) => [
          {
            name: 'config-volume',
            mountPath: '/config',
          },
          ...vms,
        ]),
        env: [
          {
            name: 'TZ',
            value: timezone,
          },
          {
            name: 'NODE_ENV',
            value: 'production',
          },
          {
            name: 'DB_HOST',
            value: dbReady.apply(() => `facility-${name}-db-rw`),
          },
          {
            name: 'DB_PASSWORD',
            valueFrom: {
              secretKeyRef: {
                name: `facility-${name}-db-app`,
                key: 'password',
              },
            },
          },
          {
            name: 'DB_USERNAME',
            valueFrom: {
              secretKeyRef: {
                name: `facility-${name}-db-app`,
                key: 'username',
              },
            },
          },
          {
            name: 'DB_NAME',
            valueFrom: {
              secretKeyRef: {
                name: `facility-${name}-db-app`,
                key: 'username',
              },
            },
          },
        ],
        resources: {
          requests: {
            cpu: '5m',
            memory: '150Mi',
          },
        },
        ...containerArgs,
      },
    ],
  });
}

export const CONFIG_FROM_ENV = {
  db: {
    host: 'DB_HOST',
    username: 'DB_USERNAME',
    password: 'DB_PASSWORD',
    name: 'DB_NAME',
  },
};

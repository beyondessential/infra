import { Output, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.js';
import { namespace } from '../namespace.js';
import { PostgresReady } from '../common/postgres.js';
import { image, imageTag } from '../image.js';
import { PodSpecArgs, PodSpecFactory, podSpreadAntiAffinity } from '../common/specFactory.js';

export function appSelector(component: string): { [key: string]: string } {
  return {
    'app.kubernetes.io/name': 'central',
    'app.kubernetes.io/component': component,
  };
}

export function appLabels(component: string): { [key: string]: string } {
  return {
    ...appSelector(component),
    'app.kubernetes.io/version': imageTag,
  };
}

export interface PodSpecFactoryArgs {
  timezone: string;
  appConfig: Output<string>;
  dbReady: PostgresReady;
}

export function podSpecFactory({ timezone, appConfig, dbReady }: PodSpecFactoryArgs): PodSpecFactory {
  return ({
    podType,
    podSpreadSelector,
    command,
    containerArgs: { volumeMounts = [], ...containerArgs } = {},
    volumes = [],
  }: PodSpecArgs): k8s.types.input.core.v1.PodSpec => {
    return {
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
                matchExpressions: [archAffinity('amd64'), purposeAffinity('workload')],
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
                      values: ['central-db'],
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
      containers: [
        {
          name: podType,
          image: image('central'),
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
              value: dbReady.apply(() => 'central-db-rw'),
            },
            {
              name: 'DB_PASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: 'central-db-app',
                  key: 'password',
                },
              },
            },
            {
              name: 'DB_USERNAME',
              valueFrom: {
                secretKeyRef: {
                  name: 'central-db-app',
                  key: 'username',
                },
              },
            },
            {
              name: 'DB_NAME',
              valueFrom: {
                secretKeyRef: {
                  name: 'central-db-app',
                  key: 'username',
                },
              },
            },
          ],
          resources: {
            requests: {
              cpu: '200m',
              memory: '200Mi',
            },
            limits: {
              cpu: '1000m',
              memory: '500Mi',
            },
          },
          ...containerArgs,
        },
      ],
    };
  };
}

export const CONFIG_FROM_ENV = {
  db: {
    host: 'DB_HOST',
    username: 'DB_USERNAME',
    password: 'DB_PASSWORD',
    name: 'DB_NAME',
  },
  countryTimeZone: 'TZ',
  localisation: {
    timeZone: 'TZ',
  },
};

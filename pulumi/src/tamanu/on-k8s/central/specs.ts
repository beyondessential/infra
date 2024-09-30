import { Output, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.js';
import { PostgresReady } from '../../../common/k8s/postgres.js';
import { PodSpecArgs, PodSpecFactory } from '../common/specFactory.js';
import { image, imageTag } from '../image.js';
import { architecture, nodeEnv, serviceAccount, SERVICE_ACCOUNT_NAME } from '../config.js';
import { compact } from 'lodash-es';

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

export function podSpecFactory({
  timezone,
  appConfig,
  dbReady,
}: PodSpecFactoryArgs): PodSpecFactory {
  return ({
    podType,
    command,
    containerArgs: { volumeMounts = [], ...containerArgs } = {},
    volumes = [],
    env = [],
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
                matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
              },
            ],
          },
        },
      },
      serviceAccountName: serviceAccount && SERVICE_ACCOUNT_NAME,
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
          env: compact([
            ...env,
            {
              name: 'TZ',
              value: timezone,
            },
            {
              name: 'NODE_ENV',
              value: nodeEnv,
            },
            imageTag.startsWith('sha-') && {
              name: 'REVISION',
              value: imageTag.replace(/^sha-/, '').slice(0, 10),
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
            {
              name: 'TUPAIA_API_USERNAME',
              valueFrom: {
                secretKeyRef: {
                  name: 'tupaia',
                  key: 'username',
                },
              },
            },
            {
              name: 'TUPAIA_API_PASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: 'tupaia',
                  key: 'password',
                },
              },
            },
            {
              name: 'MAILGUN_API_KEY',
              valueFrom: {
                secretKeyRef: {
                  name: 'mailgun',
                  key: 'apiKey',
                },
              },
            },
            {
              name: 'MAILGUN_DOMAIN',
              valueFrom: {
                secretKeyRef: {
                  name: 'mailgun',
                  key: 'domain',
                },
              },
            },
            {
              name: 'MAILGUN_FROM',
              valueFrom: {
                secretKeyRef: {
                  name: 'mailgun',
                  key: 'from',
                },
              },
            },
            {
              name: 'BUGSNAG_API_KEY',
              valueFrom: {
                secretKeyRef: {
                  name: 'bugsnag',
                  key: 'apiKey',
                },
              },
            },
          ]),
          resources: {
            requests: {
              cpu: '5m',
              memory: '200Mi',
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
  tupaiaApiClient: {
    auth: {
      username: 'TUPAIA_API_USERNAME',
      password: 'TUPAIA_API_PASSWORD',
    },
  },
  mailgun: {
    apiKey: 'MAILGUN_API_KEY',
    domain: 'MAILGUN_DOMAIN',
    from: 'MAILGUN_FROM',
  },
  errors: {
    apiKey: 'BUGSNAG_API_KEY',
  },
};

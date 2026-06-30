import { type Output, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { compact } from 'lodash-es';
import { CAN_RUN_ON_SPOT } from '../../../../common/k8s/tolerations.ts';
import { $network } from '../../../../common/k8s/coreRef.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../../common/k8s/affinities.ts';
import type { PostgresReady } from '../../../../common/k8s/postgres.ts';
import { PostgresUrlSecretKey } from '../../../../common/k8s/postgresUrl.ts';
import type { PodSpecArgs, PodSpecFactory } from '../common/specFactory.ts';
import { cryptoEnv, cryptoVolume, cryptoVolumeMount } from '../common/crypto.ts';
import { image, imageTag } from '../image.ts';
import { architecture, nodeEnv } from '../config.ts';
import { sa } from '../serviceAccount.ts';

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
  rawSecret: k8s.core.v1.Secret;
  reportingSecret: k8s.core.v1.Secret;
}

export function podSpecFactory({
  timezone,
  appConfig,
  dbReady,
  rawSecret,
  reportingSecret,
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
      serviceAccountName: sa?.metadata.name,
      volumes: [
        {
          name: 'config-volume',
          configMap: {
            name: appConfig,
          },
        },
        cryptoVolume,
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
            cryptoVolumeMount,
            ...vms,
          ]),
          env: compact([
            ...env,
            ...cryptoEnv,
            {
              name: 'TZ',
              value: timezone,
            },
            {
              name: 'TAMANU_PRIMARY_TIMEZONE',
              value: timezone,
            },
            {
              name: 'PROXY_TRUSTED',
              value: $network.apply((n) => `loopback, ${n.v4Cidr}, ${n.v6Cidr}`),
            },
            {
              name: 'DISK_PATH',
              value: '/',
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
              // Single connection string for the core user. Tamanu prefers this
              // over the structured DB_* vars below, which stay as a fallback.
              name: 'DATABASE_URL',
              valueFrom: {
                secretKeyRef: dbReady.apply(url => ({
                  name: url.metadata.name,
                  key: PostgresUrlSecretKey.AppDbUrl,
                })),
              },
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
            {
              name: 'DB_RAW_USERNAME',
              valueFrom: {
                secretKeyRef: {
                  name: rawSecret.metadata.name,
                  key: 'username',
                },
              },
            },
            {
              name: 'DB_RAW_PASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: rawSecret.metadata.name,
                  key: 'password',
                },
              },
            },
            {
              name: 'DB_REPORTING_USERNAME',
              valueFrom: {
                secretKeyRef: {
                  name: reportingSecret.metadata.name,
                  key: 'username',
                },
              },
            },
            {
              name: 'DB_REPORTING_PASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: reportingSecret.metadata.name,
                  key: 'password',
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
    reportSchemas: {
      connections: {
        raw: {
          username: 'DB_RAW_USERNAME',
          password: 'DB_RAW_PASSWORD',
        },
        reporting: {
          username: 'DB_REPORTING_USERNAME',
          password: 'DB_REPORTING_PASSWORD',
        },
      },
    },
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
  crypto: {
    keyFile: 'CRYPTO_KEY_FILE',
    settingsPsk: 'CRYPTO_SETTINGS_PSK',
  },
};

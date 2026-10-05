import { type Output, all, output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import type { PostgresReady } from '../../../../common/k8s/postgres.ts';
import { PostgresUrlSecretKey } from '../../../../common/k8s/postgresUrl.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../../common/k8s/tolerations.ts';
import { $network } from '../../../../common/k8s/coreRef.ts';
import type { PodSpecFactory, PodSpecArgs } from '../common/specFactory.ts';
import { appMemoryLimit } from '../common/specFactory.ts';
import { cryptoEnv, cryptoVolume, cryptoVolumeMount } from '../common/crypto.ts';
import type { BlobStoreVolume } from '../common/blobStore.ts';
import { architecture, nodeEnv } from '../config.ts';
import { image, imageTag } from '../image.ts';
import { compact } from 'lodash-es';

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
  rawSecret: k8s.core.v1.Secret;
  reportingSecret: k8s.core.v1.Secret;
  blobStore?: BlobStoreVolume;
}

export function podSpecFactory({
  name,
  timezone,
  appConfig,
  dbReady,
  rawSecret,
  reportingSecret,
  blobStore,
}: PodSpecFactoryArgs): PodSpecFactory {
  return ({
    podType,
    command,
    containerArgs: { volumeMounts = [], ...containerArgs } = {},
    volumes = [],
    env = [],
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
    },
    volumes: compact([
      {
        name: 'config-volume',
        configMap: {
          name: appConfig,
        },
      },
      cryptoVolume,
      blobStore?.volume,
      ...volumes,
    ]),
    containers: [
      {
        name: podType,
        image: image('facility'),
        imagePullPolicy: 'IfNotPresent',
        args: command,
        volumeMounts: output(volumeMounts).apply((vms) =>
          compact([
            {
              name: 'config-volume',
              mountPath: '/config',
            },
            cryptoVolumeMount,
            blobStore?.volumeMount,
            ...vms,
          ]),
        ),
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
            value: $network.apply((n) =>
              all([n.v4Cidr, n.v6Cidr]).apply(([v4, v6]) =>
                ['loopback', v4, v6].filter(Boolean).join(', '),
              ),
            ),
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
        // Requests sit at the typical pod's p95; the limit only stops a leak
        // from pressuring the node (peaks seen are ~650Mi).
        resources: {
          requests: {
            cpu: '5m',
            memory: '200Mi',
          },
          ...appMemoryLimit(podType),
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
  errors: {
    apiKey: 'BUGSNAG_API_KEY',
  },
  crypto: {
    keyFile: 'CRYPTO_KEY_FILE',
    settingsPsk: 'CRYPTO_SETTINGS_PSK',
  },
};

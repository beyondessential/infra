import * as k8s from '@pulumi/kubernetes';
import { architecture } from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { PostgresUrlSecretKey } from '../../../common/k8s/postgresUrl.ts';

import { image } from './image.ts';

import { dbReady } from './db.ts';
import { all } from '@pulumi/pulumi';
import { dhisConf } from './dhisConf.ts';

export function spec(
  name: string,
  command: string[] = [],
  containerArgs: Partial<k8s.types.input.core.v1.Container> = {},
): k8s.types.input.core.v1.PodSpec {
  return {
    ...containerArgs,
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
    volumes: [
      {
        name: 'dhis-conf',
        configMap: {
          name: dhisConf.metadata.name,
          defaultMode: 0o644,
        },
      },
    ],
    containers: [
      {
        image: image(),
        imagePullPolicy: 'IfNotPresent',
        name,
        args: command.length > 0 ? command : undefined,
        ports: [
          {
            containerPort: 8080,
            name: 'http',
          },
        ],
        volumeMounts: [
          {
            name: 'dhis-conf',
            mountPath: '/config',
          },
        ],
        env: all([containerArgs.env]).apply(([extraEnv]) => [
          {
            name: 'DB_JDBC_URL',
            valueFrom: {
              secretKeyRef: dbReady.apply((url) => ({
                name: url.metadata.name,
                key: PostgresUrlSecretKey.AppJdbcUrl,
              })),
            },
          },
          ...(extraEnv ?? []),
        ]),
        resources: {
          requests: {
            cpu: '2m',
            memory: '10Mi',
          },
        },
      },
    ],
  };
}

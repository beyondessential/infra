import * as k8s from '@pulumi/kubernetes';
import { architecture } from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { PostgresUrlSecretKey } from '../../../common/k8s/postgresUrl.ts';

import { image } from './image.ts';
import './ca.ts';
import { dbReady } from './db.ts';
import { all } from '@pulumi/pulumi';

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
    containers: [
      {
        image: image(),
        imagePullPolicy: 'IfNotPresent',
        name,
        args: command,
        ports: [
          {
            containerPort: 8000,
            name: 'http',
          },
        ],
        env: all([containerArgs.env]).apply(([extraEnv]) => [
          {
            name: 'BIND_ADDRESS',
            value: '[::]:8000',
          },
          {
            name: 'DATABASE_URL',
            valueFrom: {
              secretKeyRef: dbReady.apply((url) => ({
                name: url.metadata.name,
                key: PostgresUrlSecretKey.AppDbUrl,
              })),
            },
          },
          {
            name: 'RO_DATABASE_URL',
            valueFrom: {
              secretKeyRef: dbReady.apply((url) => ({
                name: url.metadata.name,
                key: PostgresUrlSecretKey.AppRoDbUrl,
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

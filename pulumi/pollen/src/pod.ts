import type { types } from '@pulumi/kubernetes';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { PostgresUrlSecretKey } from '../../common/k8s/postgresUrl.ts';
import { architecture } from './config.ts';
import { dbReady } from './db.ts';

export const scheduling = {
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
            matchExpressions: [purposeAffinity('workload'), archAffinity(architecture)],
          },
        ],
      },
    },
  },
};

export const databaseUrlEnv: types.input.core.v1.EnvVar = {
  name: 'DATABASE_URL',
  valueFrom: {
    secretKeyRef: dbReady.apply((url) => ({
      name: url.metadata.name,
      key: PostgresUrlSecretKey.AppDbUrl,
    })),
  },
};

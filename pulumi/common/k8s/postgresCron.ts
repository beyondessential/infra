import { type CustomResourceOptions, type Input, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { PostgresUrlSecretKey } from './postgresUrl.ts';
import type { Architecture } from './affinities.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from './affinities.ts';
import { CAN_RUN_ON_SPOT } from './tolerations.ts';
import { DEFAULT_POSTGRES_VERSION } from '../../constants/internal.ts';

export interface PostgresCronJobArgs {
  namespace: Input<string>;
  schedule: Input<string>;
  command: Input<string>;
  dbReady: Output<k8s.core.v1.Secret>;
  dbService: Input<string>;
  dbName?: Input<string>;
  dbUser?: Input<string>;
  architecture?: Architecture;
  labels?: Input<{ [key: string]: Input<string> }>;
  backoffLimit?: Input<number>;
  postgresVersion?: Input<number>;
  resources?: k8s.types.input.core.v1.ResourceRequirements;
}

export function postgresCronJob(
  name: string,
  {
    namespace,
    schedule,
    command,
    dbReady,
    dbService,
    dbName = 'app',
    dbUser = 'app',
    architecture = 'arm64',
    labels = {},
    // These pods prefer spot and run a single short statement, so a bad spot
    // window can burn several attempts in a row without the statement ever
    // reaching the database. Retries cost 10m CPU against work that is
    // idempotent by construction, so buy enough of them to ride one out: four
    // attempts was not enough on 2026-05-31, which took out both of canopy's
    // partition jobs for the night.
    backoffLimit = 10,
    postgresVersion = DEFAULT_POSTGRES_VERSION,
    resources = {
      requests: {
        cpu: '10m',
        memory: '32Mi',
      },
      limits: {
        cpu: '100m',
        memory: '128Mi',
      },
    },
  }: PostgresCronJobArgs,
  opts?: CustomResourceOptions,
): k8s.batch.v1.CronJob {
  return new k8s.batch.v1.CronJob(
    name,
    {
      metadata: {
        labels,
        namespace,
      },
      spec: {
        schedule,
        jobTemplate: {
          metadata: {
            labels,
          },
          spec: {
            backoffLimit,
            template: {
              metadata: {
                labels,
              },
              spec: {
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
                          matchExpressions: [
                            archAffinity(architecture),
                            purposeAffinity('workload'),
                          ],
                        },
                      ],
                    },
                  },
                },
                restartPolicy: 'Never',
                containers: [
                  {
                    name,
                    image: `postgres:${postgresVersion}`,
                    command: ['psql'],
                    args: ['-c', command],
                    env: [
                      {
                        name: 'PGDATABASE',
                        value: dbName,
                      },
                      {
                        name: 'PGHOST',
                        value: dbService,
                      },
                      {
                        name: 'PGUSER',
                        value: dbUser,
                      },
                      {
                        name: 'PGPASSWORD',
                        valueFrom: {
                          secretKeyRef: dbReady.apply((url) => ({
                            name: url.metadata.name,
                            key: PostgresUrlSecretKey.AppPassword,
                          })),
                        },
                      },
                    ],
                    resources,
                  },
                ],
              },
            },
          },
        },
      },
    },
    opts,
  );
}

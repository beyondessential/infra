import { ComponentResource, type Input, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sWaitFor } from './waitFor.ts';
import { CAN_RUN_ON_SPOT } from './tolerations.ts';
import { RUN_ON_SPOT } from './affinities.ts';
import { postgresUrlSecret } from './postgresUrl.ts';
import { backups } from './coreRef.ts';
import { DEFAULT_POSTGRES_VERSION } from '../../constants/internal.ts';

export interface PostgresArgs {
  parent?: ComponentResource;
  namespace: Input<string>;
  name: Input<string>;
  replicas: Input<number>;
  storage: Input<string>;
  timezone: Input<string>;
  backupSchedule?: Input<string | boolean>;
  majorVersion?: Input<number>;
  postgis?: boolean;
  roles?: Input<Input<ManagedRole>[]>;
  initSql?: Input<string>;
  seedSnapshotName?: Input<string>;
}

// https://cloudnative-pg.io/documentation/1.26/cloudnative-pg.v1/#postgresql-cnpg-io-v1-RoleConfiguration
export interface ManagedRole {
  name: Input<string>;
  passwordSecret?: Input<LocalObjectReference>;
  inRoles?: Input<Input<string>[]>;
  disablePassword?: Input<boolean>;
  createdb?: Input<boolean>;
  createrole?: Input<boolean>;
  login?: Input<boolean>;
}

export interface LocalObjectReference {
  name: Input<string>;
}

export type PostgresReady = Output<k8s.core.v1.Secret>;

export function runPostgres({
  parent,
  namespace,
  name,
  replicas,
  storage,
  timezone,
  backupSchedule,
  majorVersion = DEFAULT_POSTGRES_VERSION,
  postgis = false,
  roles = [],
  initSql,
  seedSnapshotName,
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
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        imageCatalogRef: {
          apiGroup: 'postgresql.cnpg.io',
          kind: 'ClusterImageCatalog',
          name: postgis ? 'postgis' : 'postgresql',
          major: majorVersion,
        },
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
            memory: '750Mi',
            cpu: '10m',
          },
        },
        postgresql: {
          parameters: {
            // should be about 25% of requested memory
            shared_buffers: '200MB',
          },
        },
        managed: {
          roles,
        },
        bootstrap: seedSnapshotName
          ? {
              recovery: {
                volumeSnapshots: {
                  storage: { name: seedSnapshotName },
                },
              },
            }
          : initSql
            ? {
                initdb: {
                  postInitApplicationSQL: [initSql],
                },
              }
            : {},
        affinity: {
          nodeSelector: {
            'bes.node.purpose': 'workload',
          },
          tolerations: [CAN_RUN_ON_SPOT],
          nodeAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [
              {
                weight: 1,
                preference: RUN_ON_SPOT,
              },
            ],
          },
        },
        serviceAccountTemplate: {
          metadata: {
            annotations: {
              'eks.amazonaws.com/role-arn': backups.sa,
            },
          },
        },
        backup: backupSchedule
          ? {
              volumeSnapshot: {
                className: 'ebs',
              },
            }
          : {},
        // logLevel: 'trace',
      },
    },
    { parent },
  );

  if (backupSchedule) {
    if (backupSchedule === true) backupSchedule = '0 0 0 * * 1'; // weekly
    // TODO: retention policy for snapshots when that lands
    // https://github.com/cloudnative-pg/cloudnative-pg/issues/6009
    new k8s.apiextensions.CustomResource(
      `${name}-backup`,
      {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'ScheduledBackup',
        metadata: {
          name: `${name}-backup`,
          namespace,
          labels: {
            'app.kubernetes.io/name': name,
            'app.kubernetes.io/component': 'database',
          },
        },
        spec: {
          schedule: backupSchedule,
          method: 'volumeSnapshot',
          backupOwnerReference: 'self',
          cluster: { name: `${name}-db` },
        },
      },
      { parent, ignoreChanges: ['spec.schedule'] },
    );
  }

  const dbReady = k8sWaitFor(
    `${name}-db`,
    async (kc, namespace) => {
      const k8sApi = kc.makeApiClient(CoreV1Api);
      const endpoint = await k8sApi.readNamespacedEndpoints({ name: `${name}-db-rw`, namespace });
      const readyAddresses = endpoint?.subsets?.[0]?.addresses ?? [];
      if (readyAddresses.length === 0) {
        throw new Error('No ready addresses');
      }
    },
    namespace,
  );
  const url = postgresUrlSecret({ parent, namespace, name, dbReady });
  return dbReady.apply(() => url);
}

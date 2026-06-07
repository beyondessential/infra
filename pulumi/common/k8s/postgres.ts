import { ComponentResource, interpolate, type Input, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sWaitFor } from './waitFor.ts';
import { CAN_RUN_ON_SPOT } from './tolerations.ts';
import { RUN_ON_SPOT } from './affinities.ts';
import { postgresUrlSecret } from './postgresUrl.ts';
import { backups } from './coreRef.ts';
import { DEFAULT_POSTGRES_VERSION } from '../../constants/internal.ts';

export interface BarmanBackupArgs {
  bucket: Input<string>;
  deployName: string;
  retentionDays: number;
}

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
  // Labels propagated via inheritedMetadata to all pods in the cluster.
  // Used for AWS split cost allocation (CUR pod label attribution).
  inheritedMetadataLabels?: Record<string, string>;
  // When provided, overrides the default IRSA annotation in serviceAccountTemplate.
  // Pass this for every cluster (even when barmanBackup is absent) so the annotation
  // is pre-populated and ready when barmanBackup is later enabled.
  barmanRoleArn?: string;
  // When provided, enables Barman Cloud WAL archiving + scheduled base backups.
  barmanBackup?: BarmanBackupArgs;
  // Require all instances of this cluster in the same AZ (still on different
  // nodes via CNPG's default hostname anti-affinity). Keeps replication
  // traffic off the cross-AZ meter at the cost of AZ-failure tolerance; for
  // environments that don't need to survive an AZ loss.
  colocateAz?: boolean;
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
  barmanRoleArn,
  barmanBackup,
  inheritedMetadataLabels,
  colocateAz = false,
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
        ...(inheritedMetadataLabels
          ? { inheritedMetadata: { labels: inheritedMetadataLabels } }
          : {}),
        imageCatalogRef: {
          apiGroup: 'postgresql.cnpg.io',
          kind: 'ClusterImageCatalog',
          name: postgis ? 'postgis-system-bookworm' : 'postgresql',
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
            // halves-ish WAL volume on full-page-write-heavy churn, which
            // shrinks replication traffic, pg_wal I/O, and backup sizes
            wal_compression: 'lz4',
          },
        },
        managed: {
          roles,
        },
        bootstrap: seedSnapshotName
          ? {
              recovery: {
                volumeSnapshots: {
                  // CNPG's CRD validates this as a core/v1 TypedLocalObjectReference,
                  // which requires apiGroup + kind as strings (null fails validation).
                  storage: {
                    apiGroup: 'snapshot.storage.k8s.io',
                    kind: 'VolumeSnapshot',
                    name: seedSnapshotName,
                  },
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
            // arm64 is the default workload arch; both the standard cnpg
            // postgres image and the postgis variant publish arm64. Pinning
            // here so CA scales the arm pool in the right AZ rather than
            // letting the scheduler land on a leftover amd64 node.
            'bes.node.arch': 'arm64',
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
          ...(colocateAz
            ? {
                additionalPodAffinity: {
                  requiredDuringSchedulingIgnoredDuringExecution: [
                    {
                      labelSelector: { matchLabels: { 'cnpg.io/cluster': `${name}-db` } },
                      topologyKey: 'topology.kubernetes.io/zone',
                    },
                  ],
                },
              }
            : {}),
        },
        serviceAccountTemplate: {
          metadata: {
            annotations: {
              'eks.amazonaws.com/role-arn': barmanRoleArn ?? backups.sa,
            },
          },
        },
        ...(barmanBackup
          ? {
              plugins: [
                {
                  name: 'barman-cloud.cloudnative-pg.io',
                  isWALArchiver: true,
                  parameters: {
                    barmanObjectName: `${name}-db-object-store`,
                    serverName: `${name}-db`,
                  },
                },
              ],
            }
          : {}),
        backup: {
          ...(backupSchedule ? { volumeSnapshot: { className: 'ebs' } } : {}),
        },
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

  if (barmanBackup) {
    const objectStore = new k8s.apiextensions.CustomResource(
      `${name}-db-object-store`,
      {
        apiVersion: 'barmancloud.cnpg.io/v1',
        kind: 'ObjectStore',
        metadata: {
          name: `${name}-db-object-store`,
          namespace,
        },
        spec: {
          retentionPolicy: `${barmanBackup.retentionDays}d`,
          configuration: {
            destinationPath: interpolate`s3://${barmanBackup.bucket}/${barmanBackup.deployName}/${name}-db/`,
            s3Credentials: {
              inheritFromIAMRole: true,
            },
            wal: {
              compression: 'gzip',
            },
            data: {
              compression: 'gzip',
            },
          },
        },
      },
      { parent },
    );

    new k8s.apiextensions.CustomResource(
      `${name}-db-scheduled-backup`,
      {
        apiVersion: 'postgresql.cnpg.io/v1',
        kind: 'ScheduledBackup',
        metadata: {
          name: `${name}-db-scheduled`,
          namespace,
        },
        spec: {
          schedule: '0 0 2 * * *',
          immediate: true,
          backupOwnerReference: 'self',
          cluster: {
            name: `${name}-db`,
          },
          method: 'plugin',
          pluginConfiguration: {
            name: 'barman-cloud.cloudnative-pg.io',
          },
        },
      },
      { dependsOn: [objectStore], parent },
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

import { all, ComponentResource, interpolate, type Input, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { CoreV1Api } from '@kubernetes/client-node';
import { k8sWaitFor } from './waitFor.ts';
import { derivePostgresParameters } from './postgresTuning.ts';
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
  // Override the postmaster max_connections. Raising it divides work_mem
  // across more backends, so bump memoryRequest alongside. Changing it
  // triggers a rolling restart.
  maxConnections?: Input<number>;
  // Memory request for the postgres container, and the basis every
  // memory-derived postgres parameter is computed from.
  memoryRequest?: Input<string>;
  // 'dedicated' runs the instances only on the on-demand pool for critical
  // databases, one per node; 'ondemand' runs them only on the general
  // on-demand workload pools; the default prefers spot capacity.
  placement?: 'spot' | 'ondemand' | 'dedicated';
  // Keep CNPG's PodDisruptionBudgets. The primary's budget allows no
  // evictions, so every node holding a primary is exempt from consolidation;
  // turn this off where a failover on drain is acceptable.
  disruptionBudgets?: boolean;
  // Expose CNPG's :9187 metrics to the (annotation-based, operator-less)
  // Prometheus via a dedicated metrics-only Service. Annotating the cluster
  // pods directly would also annotate the rw/r/ro services and double-scrape.
  scrapeMetrics?: boolean;
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

// Tolerations and affinity per placement; the nodeSelector carries the hard
// pool constraints.
const PLACEMENT_SCHEDULING = {
  spot: {
    tolerations: [CAN_RUN_ON_SPOT],
    nodeAffinity: {
      preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 1, preference: RUN_ON_SPOT }],
    },
  },
  ondemand: {},
  dedicated: {
    tolerations: [
      { key: 'bes.node.group', operator: 'Equal', value: 'db-critical', effect: 'NoSchedule' },
    ],
    podAntiAffinityType: 'required',
  },
} satisfies Record<NonNullable<PostgresArgs['placement']>, object>;

export function runPostgres({
  parent,
  namespace,
  name,
  replicas,
  storage,
  timezone,
  majorVersion = DEFAULT_POSTGRES_VERSION,
  postgis = false,
  roles = [],
  initSql,
  seedSnapshotName,
  barmanRoleArn,
  barmanBackup,
  inheritedMetadataLabels,
  colocateAz = false,
  maxConnections = 100,
  memoryRequest = '750Mi',
  disruptionBudgets = true,
  placement = 'spot',
  scrapeMetrics = false,
}: PostgresArgs): PostgresReady {
  const cluster = new k8s.apiextensions.CustomResource(
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
        // k[postgres.disruption.opt-out]
        enablePDB: disruptionBudgets,
        // Maintain the <name>-db-superuser secret: the reporting-grants Job and
        // the postgres URLs in <name>-db-url read it, and CNPG only creates it
        // when superuser access is enabled (off by default since CNPG 1.21).
        enableSuperuserAccess: true,
        primaryUpdateStrategy: 'unsupervised',
        // k[postgres.primary-update.switchover]
        // The operator rejects any single update that changes both the image
        // and postgres parameters under this method; split such changes.
        primaryUpdateMethod: 'switchover',
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
            memory: memoryRequest,
            cpu: '10m',
          },
        },
        postgresql: {
          // Derived from the memory request above and the volume size, so a
          // cluster given more resources gets parameters to match.
          // k[postgres.tuning.basis]
          parameters: all([memoryRequest, storage, maxConnections]).apply(
            ([memory, volume, connections]) =>
              derivePostgresParameters({
                memory,
                storage: volume,
                maxConnections: connections,
              }),
          ),
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
        // k[postgres.placement.dedicated+2] k[postgres.placement.on-demand]
        affinity: {
          nodeSelector: {
            'bes.node.purpose': 'workload',
            // arm64 is the default workload arch; both the standard cnpg
            // postgres image and the postgis variant publish arm64. Pinning
            // here so CA scales the arm pool in the right AZ rather than
            // letting the scheduler land on a leftover amd64 node.
            'bes.node.arch': 'arm64',
            ...(placement === 'dedicated' ? { 'bes.node.group': 'db-critical' } : {}),
            ...(placement === 'ondemand' ? { 'bes.node.schedule': 'ondemand' } : {}),
          },
          ...PLACEMENT_SCHEDULING[placement],
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
        // logLevel: 'trace',
      },
    },
    { parent },
  );

  // Backups are Barman only. Scheduled volume snapshots used to be an option
  // here and are not, because CNPG has no retention for them
  // (cloudnative-pg#6009) — so every cluster using them accumulated snapshots
  // indefinitely, as meta-db did from March 2025 — and because they recover only
  // to the snapshot instant, where Barman archives WAL continuously.
  //
  // Snapshots remain how a cluster is *seeded*: see seedSnapshotName above,
  // which restores from one at bootstrap. That path is unrelated to this.
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
          // k[postgres.backup-sidecar.requests]
          instanceSidecarConfiguration: {
            resources: {
              requests: { cpu: '10m', memory: '128Mi' },
            },
          },
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

  if (scrapeMetrics) {
    // Metrics-only Service: the annotation-based Prometheus scrapes CNPG's
    // :9187 exporter once per instance pod through this endpoint. Kept separate
    // from the rw/r/ro services so only this one carries the scrape annotation.
    new k8s.core.v1.Service(
      `${name}-db-metrics`,
      {
        metadata: {
          name: `${name}-db-metrics`,
          namespace,
          labels: {
            'app.kubernetes.io/name': name,
            'app.kubernetes.io/component': 'database',
          },
          annotations: {
            'prometheus.io/scrape': 'true',
            'prometheus.io/port': '9187',
            'prometheus.io/path': '/metrics',
          },
        },
        spec: {
          clusterIP: 'None',
          selector: { 'cnpg.io/cluster': `${name}-db` },
          ports: [{ name: 'metrics', port: 9187, targetPort: 'metrics', protocol: 'TCP' }],
        },
      },
      { parent },
    );
  }

  // k[postgres.readiness]
  // Keyed on the cluster resource's id, which resolves only once Pulumi's create or
  // update of it succeeded: an existing cluster still serves from before a rejected
  // update, and dependents would otherwise start against it and wait on a superuser
  // secret that the rejected update was meant to enable.
  const dbReady = k8sWaitFor(
    `${name}-db`,
    async (kc, [namespace]) => {
      const k8sApi = kc.makeApiClient(CoreV1Api);
      const endpoint = await k8sApi.readNamespacedEndpoints({ name: `${name}-db-rw`, namespace });
      const readyAddresses = endpoint?.subsets?.[0]?.addresses ?? [];
      if (readyAddresses.length === 0) {
        throw new Error('No ready addresses');
      }
      await k8sApi.readNamespacedSecret({ name: `${name}-db-superuser`, namespace });
    },
    all([namespace, cluster.id]),
  );
  const url = postgresUrlSecret({ parent, namespace, name, dbReady });
  return dbReady.apply(() => url);
}

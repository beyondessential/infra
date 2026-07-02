import { ComponentResource, type ComponentResourceOptions, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as semver from 'semver';
import { runPostgres } from '../../../../common/k8s/postgres.ts';
import { templatedConfig } from '../common/templatedConfig.ts';
import { migrator } from '../common/migrator.ts';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.ts';
import { runServer } from './server.ts';
import { ingress } from '../common/ingress.ts';
import { WebFrontend } from '../web/WebFrontend.ts';
import { appVersion,
  type ReplicaConfig,
  BARMAN_BACKUP_BUCKET,
  BARMAN_BACKUP_ROLE_ARN,
  backupRetentionDays,
  backupsEnabled,
  costLabels,
  dbAzColocate,
  dbBackups,
  dbStorage,
  normalizedStack,
  timezone,
} from '../config.ts';
import { runTasks } from './tasks.ts';
import type { Provisioning } from '../central/provisioner.ts';
import { namespace } from '../namespace.ts';
import { reportingRoles } from '../common/reportingRoles.ts';

export interface FacilityServerArgs {
  fqdn: string;
  centralApiUrl: string;
  facilityId: string;
  deviceId: string;
  replicas: ReplicaConfig;
  provisioning: Output<Provisioning>;
}

export class FacilityServer extends ComponentResource {
  readonly ingress: k8s.apiextensions.CustomResource;

  constructor(
    name: string,
    { fqdn, centralApiUrl, facilityId, deviceId, replicas, provisioning }: FacilityServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:FacilityServer', name, {}, opts);

    const roles = reportingRoles({
      parent: this,
      server: `facility-${name}`,
    });

    const dbReady = runPostgres({
      parent: this,
      namespace,
      name: `facility-${name}`,
      replicas: replicas.db,
      storage: dbStorage,
      timezone,
      backupSchedule: dbBackups,
      colocateAz: dbAzColocate,
      roles: roles.roles,
      initSql: roles.initSql,
      barmanRoleArn: BARMAN_BACKUP_ROLE_ARN,
      barmanBackup: backupsEnabled
        ? { bucket: BARMAN_BACKUP_BUCKET, deployName: normalizedStack, retentionDays: backupRetentionDays }
        : undefined,
      inheritedMetadataLabels: costLabels,
    });

    // setupSync ships in Tamanu 2.60; older release images (standing envs pinned
    // to old tags, rc deploys of patch releases) lack the subcommand, so they
    // keep the legacy config-based sync setup and skip the seeding Job entirely.
    // Branch-built deploys (no appVersion) always include it.
    const hasSetupSync = appVersion == null || semver.gte(appVersion, '2.60.0-0');

    const appConfig = provisioning.apply((provisioning) =>
      templatedConfig({
        parent: this,
        kind: 'config-facility',
        name: `facility-${name}`,
        additionalData: {
          'custom-environment-variables.json': JSON.stringify(CONFIG_FROM_ENV),
        },
        templateData: {
          fqdn,
          instance: `facility-${name}`,
          facilityId,
          deviceId,
          timezone,
          provisioning,
          legacySyncConfig: !hasSetupSync,
          centralApiUrl,
          syncApiUrl: `http://facility-${name}-sync`,
          syncApiPort: 80,
        },
      }),
    );

    const podSpec = podSpecFactory({
      name,
      timezone,
      appConfig: appConfig.metadata.name,
      dbReady,
      rawSecret: roles.raw,
      reportingSecret: roles.reporting,
    });

    const migratorJob = migrator(`facility-${name}`, {
      parent: this,
      podSpec,
      appConfig,
    });

    // Seed the central host/credentials/facility into local system facts so the
    // server is fact-configured without the setup wizard. The sync user is the
    // provisioned admin. Runs after migrate (needs the facts table) and gates the
    // sync/api/tasks processes so they boot already configured.
    const syncUrl = provisioning.apply((p) => {
      const url = new URL(centralApiUrl);
      url.username = 'admin@tamanu.io';
      url.password = p.users['admin@tamanu.io'].password;
      return url.toString();
    });
    const setupSyncJob = !hasSetupSync
      ? undefined
      : new k8s.batch.v1.Job(
      `facility-${name}-setup-sync`,
      {
        metadata: { namespace },
        spec: {
          backoffLimit: 5,
          template: {
            spec: {
              ...podSpec({
                podType: 'setup-sync',
                command: ['setupSync'],
                env: [{ name: 'SYNC_URL', value: syncUrl }],
              }),
              restartPolicy: 'Never',
            },
          },
        },
      },
      { parent: this, dependsOn: [migratorJob] },
    );
    // What the server processes wait on: the seeding Job when it runs (it
    // itself waits on the migrator), otherwise the migrator directly.
    const readyJob = setupSyncJob ?? migratorJob;

    if (replicas.tasks > 0) {
      runTasks(name, {
        parent: this,
        deviceId,
        podSpec,
        // Gate on the sync-config seed (which itself waits on the migrator).
        migratorJob: readyJob,
      });
    }

    const sync = runServer(name, 'sync', {
      parent: this,
      deviceId,
      podSpec,
      dependsOn: [readyJob],
    });

    const api = runServer(name, 'api', {
      parent: this,
      deviceId,
      podSpec,
      dependsOn: [readyJob, sync.service],
      replicas: replicas.api,
    });

    const web = new WebFrontend(
      `facility-${name}`,
      {
        serverType: 'facility',
        instance: deviceId,
        replicas: replicas.web,
      },
      { parent: this },
    );

    this.ingress = ingress({
      name: `facility-${name}`,
      parent: this,
      host: fqdn,
      web: web.service,
      api: api.service,
    });
  }
}

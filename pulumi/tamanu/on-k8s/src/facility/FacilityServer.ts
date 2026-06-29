import { ComponentResource, type ComponentResourceOptions, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { runPostgres } from '../../../../common/k8s/postgres.ts';
import { templatedConfig } from '../common/templatedConfig.ts';
import { migrator } from '../common/migrator.ts';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.ts';
import { runServer } from './server.ts';
import { ingress } from '../common/ingress.ts';
import { WebFrontend } from '../web/WebFrontend.ts';
import {
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
    const setupSyncJob = new k8s.batch.v1.Job(
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

    if (replicas.tasks > 0) {
      runTasks(name, {
        parent: this,
        deviceId,
        podSpec,
        // Gate on the sync-config seed (which itself waits on the migrator).
        migratorJob: setupSyncJob,
      });
    }

    const sync = runServer(name, 'sync', {
      parent: this,
      deviceId,
      podSpec,
      dependsOn: [setupSyncJob],
    });

    const api = runServer(name, 'api', {
      parent: this,
      deviceId,
      podSpec,
      dependsOn: [setupSyncJob, sync.service],
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

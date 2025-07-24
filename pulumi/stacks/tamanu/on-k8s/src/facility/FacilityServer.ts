import { ComponentResource, type ComponentResourceOptions, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { runPostgres } from '../../../../common/k8s/postgres.ts';
import { templatedConfig } from '../common/templatedConfig.ts';
import { migrator } from '../common/migrator.ts';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.ts';
import { runServer } from './server.ts';
import { ingress } from '../common/ingress.ts';
import { WebFrontend } from '../web/WebFrontend.ts';
import { type ReplicaConfig, dbBackups, dbStorage, timezone } from '../config.ts';
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
  readonly ingress: k8s.networking.v1.Ingress;

  constructor(
    name: string,
    { fqdn, centralApiUrl, facilityId, deviceId, replicas, provisioning }: FacilityServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:FacilityServer', name, {}, opts);

    const { roles, initSql } = reportingRoles({
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
      roles,
      initSql,
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
    });

    const migratorJob = migrator(`facility-${name}`, {
      parent: this,
      podSpec,
      appConfig,
    });

    if (replicas.tasks > 0) {
      runTasks(name, {
        parent: this,
        deviceId,
        podSpec,
        migratorJob,
      });
    }

    const sync = runServer(name, 'sync', {
      parent: this,
      deviceId,
      podSpec,
      dependsOn: [migratorJob],
    });

    const api = runServer(name, 'api', {
      parent: this,
      deviceId,
      podSpec,
      dependsOn: [migratorJob, sync.service],
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

import { ComponentResource, ComponentResourceOptions, Input, Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { runPostgres } from '../../../common/k8s/postgres.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { migrator } from '../common/migrator.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { runApi } from './api.js';
import { ingress } from '../common/ingress.js';
import { WebFrontend } from '../web/WebFrontend.js';
import { ReplicaConfig, dbStorage, timezone } from '../config.js';
import { runTasks } from './tasks.js';
import { Provisioning } from '../central/provisioner.js';
import { namespace } from '../namespace.js';

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

    const dbReady = runPostgres({
      parent: this,
      namespace,
      name: `facility-${name}`,
      replicas: replicas.db,
      storage: dbStorage,
      timezone,
    });

    const appConfig = provisioning.apply(provisioning => templatedConfig({
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
      },
    }));

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

    const api = runApi(name, {
      parent: this,
      deviceId,
      podSpec,
      migratorJob,
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

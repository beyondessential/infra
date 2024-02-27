import { ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { runPostgres } from '../common/postgres.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { migrator } from '../common/migrator.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { runApi } from './api.js';
import { ingress } from '../common/ingress.js';
import { WebFrontend } from '../web/WebFrontend.js';
import { ReplicaConfig, dbStorage, timezone } from '../config.js';

export interface FacilityServerArgs {
  fqdn: string;
  centralApiUrl: string;
  facilityId: string;
  deviceId: string;
  replicas: ReplicaConfig;
}

export class FacilityServer extends ComponentResource {
  readonly ingress: k8s.networking.v1.Ingress;

  constructor(
    name: string,
    { fqdn, centralApiUrl, facilityId, deviceId, replicas }: FacilityServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:FacilityServer', name, {}, opts);

    const dbReady = runPostgres({
      parent: this,
      name: `facility-${name}`,
      replicas: replicas.db,
      storage: dbStorage,
      timezone,
    });

    const appConfig = templatedConfig({
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
      },
    });

    const podSpec = podSpecFactory({
      name,
      timezone,
      appConfig: appConfig.metadata.name,
      dbReady,
      facilityId,
      deviceId,
      centralApiUrl,
    });

    const migratorJob = migrator(`facility-${name}`, {
      parent: this,
      podSpec,
      appConfig,
    });

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

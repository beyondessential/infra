import { ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { runPostgres } from '../common/postgres.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { migrator } from '../common/migrator.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { runApi } from './api.js';
import { ingress } from '../common/ingress.js';
import { WebFrontend } from '../web/WebFrontend.js';

export interface FacilityServerArgs {
  fqdn: string;
  centralApiUrl: string;
  facilityId: string;
  deviceId: string;
  dbReplicas?: number;
  dbStorage?: string;
  timezone?: string;
}

export class FacilityServer extends ComponentResource {
  readonly ingress: k8s.networking.v1.Ingress;

  constructor(
    name: string,
    {
      fqdn,
      centralApiUrl,
      facilityId,
      deviceId,
      dbReplicas = 2, // as it runs on spot
      dbStorage = '5Gi',
      timezone = 'UTC',
    }: FacilityServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:FacilityServer', name, {}, opts);

    const dbReady = runPostgres({
      parent: this,
      name: `facility-${name}`,
      replicas: dbReplicas,
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
    });

    const web = new WebFrontend(
      `facility-${name}`,
      {
        serverType: 'facility',
        instance: deviceId,
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

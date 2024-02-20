import { ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { migrator } from '../common/migrator.js';
import { runPostgres } from '../common/postgres.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { provisioner } from './provisioner.js';
import { runTasks } from './tasks.js';
import { runApi } from './api.js';
import { WebFrontend } from '../web/WebFrontend.js';
import { ingress } from '../common/ingress.js';

export interface CentralServerArgs {
  fqdn: string;
  apiReplicas?: number;
  dbReplicas?: number;
  dbStorage?: string;
  timezone?: string;
}

export class CentralServer extends ComponentResource {
  readonly fqdn: string;
  readonly ingress: k8s.networking.v1.Ingress;

  constructor(
    name: string,
    {
      fqdn,
      apiReplicas = 2,
      dbReplicas = 2,
      dbStorage = '10Gi',
      timezone = 'UTC',
    }: CentralServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:CentralServer', name, {}, opts);
    this.fqdn = fqdn;

    const dbReady = runPostgres({
      parent: this,
      name: 'central',
      replicas: dbReplicas,
      storage: dbStorage,
      timezone,
    });

    const appConfig = templatedConfig({
      parent: this,
      kind: 'config-central',
      name: 'central',
      additionalData: {
        'custom-environment-variables.json': JSON.stringify(CONFIG_FROM_ENV),
      },
    });

    const podSpec = podSpecFactory({
      timezone,
      appConfig: appConfig.metadata.name,
      dbReady,
    });

    const migratorJob = migrator('central', { parent: this, podSpec, appConfig });
    const provisionerJob = provisioner({ parent: this, podSpec, migratorJob });

    runTasks({
      parent: this,
      podSpec,
      migratorJob,
      provisionerJob,
    });

    const api = runApi({
      parent: this,
      replicas: apiReplicas,
      podSpec,
      migratorJob,
      provisionerJob,
    });

    const web = new WebFrontend(
      'central',
      {
        serverType: 'central',
      },
      { parent: this },
    );

    this.ingress = ingress({
      name: 'central',
      parent: this,
      host: fqdn,
      web: web.service,
      api: api.service,
    });
  }
}

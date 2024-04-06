import { ComponentResource, ComponentResourceOptions, Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { migrator } from '../common/migrator.js';
import { runPostgres } from '../common/postgres.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { Provisioning, provisioner } from './provisioner.js';
import { runTasks } from './tasks.js';
import { runApi } from './api.js';
import { WebFrontend } from '../web/WebFrontend.js';
import { ingress } from '../common/ingress.js';
import { ReplicaConfig, dbStorage, timezone } from '../config.js';

export interface CentralServerArgs {
  fqdn: string;
  replicas: ReplicaConfig;
}

export class CentralServer extends ComponentResource {
  readonly fqdn: string;
  readonly ingress: k8s.networking.v1.Ingress;
  readonly provisioning: Output<Provisioning>;

  constructor(
    name: string,
    { fqdn, replicas }: CentralServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:CentralServer', name, {}, opts);
    this.fqdn = fqdn;

    const dbReady = runPostgres({
      parent: this,
      name: 'central',
      replicas: replicas.db,
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
      templateData: {
        fqdn,
      },
    });

    const podSpec = podSpecFactory({
      timezone,
      appConfig: appConfig.metadata.name,
      dbReady,
    });

    const migratorJob = migrator('central', { parent: this, podSpec, appConfig });
    const { job: provisionerJob, provisioning } = provisioner({ parent: this, podSpec, migratorJob });
    this.provisioning = provisioning;

    if (replicas.tasks > 0) {
      runTasks({
        parent: this,
        podSpec,
        migratorJob,
        provisionerJob,
      });
    }

    const api = runApi({
      parent: this,
      replicas: replicas.api,
      podSpec,
      migratorJob,
      provisionerJob,
    });

    const web = new WebFrontend(
      'central',
      {
        serverType: 'central',
        replicas: replicas.web,
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

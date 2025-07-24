import { ComponentResource, type ComponentResourceOptions, Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { migrator } from '../common/migrator.ts';
import { runPostgres } from '../../../../common/k8s/postgres.ts';
import { templatedConfig } from '../common/templatedConfig.ts';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.ts';
import { type Provisioning, provisioner } from './provisioner.ts';
import { runTasks } from './tasks.ts';
import { runApi } from './api.ts';
import { runFhirWorker } from './fhir.ts';
import { WebFrontend } from '../web/WebFrontend.ts';
import { ingress } from '../common/ingress.ts';
import { type ReplicaConfig, dbBackups, dbStorage, timezone } from '../config.ts';
import { namespace } from '../namespace.ts';
import { reportingRoles } from '../common/reportingRoles.ts';

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

    const { roles, initSql } = reportingRoles({
      parent: this,
      server: 'central',
    });

    const dbReady = runPostgres({
      parent: this,
      namespace,
      name: 'central',
      replicas: replicas.db,
      storage: dbStorage,
      timezone,
      backupSchedule: dbBackups,
      roles,
      initSql,
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
        timezone,
      },
    });

    const podSpec = podSpecFactory({
      timezone,
      appConfig: appConfig.metadata.name,
      dbReady,
    });

    const migratorJob = migrator('central', { parent: this, podSpec, appConfig });
    const { job: provisionerJob, provisioning } = provisioner({
      parent: this,
      podSpec,
      migratorJob,
    });
    this.provisioning = provisioning;

    runTasks({
      parent: this,
      podSpec,
      migratorJob,
      provisionerJob,
      enabled: replicas.tasks > 0,
    });

    runFhirWorker({
      parent: this,
      podSpec,
      migratorJob,
      provisionerJob,
      name: 'refresh',
      topics: [
        'fhir.refresh.allFromUpstream',
        'fhir.refresh.entireResource',
        'fhir.refresh.fromUpstream',
      ],
      replicas: replicas.tasks,
    });

    runFhirWorker({
      parent: this,
      podSpec,
      migratorJob,
      provisionerJob,
      name: 'resolver',
      topics: ['fhir.resolver'],
      replicas: replicas.tasks,
    });

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

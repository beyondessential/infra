import { ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { migrator } from '../common/migrator.js';
import { runHaproxy } from '../common/haproxy.js';
import { runPostgres } from '../common/postgres.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { provisioner } from './provisioner.js';
import { runTasks } from './tasks.js';
import { runApi } from './api.js';

export interface CentralServerArgs {
  apiReplicas?: number;
  dbReplicas?: number;
  dbStorage?: string;
  timezone?: string;
}

export class CentralServer extends ComponentResource {
  readonly apiService: k8s.core.v1.Service;
  readonly tasksDeployment: k8s.apps.v1.Deployment;
  readonly apiDeployment: k8s.apps.v1.Deployment;

  constructor(
    name: string,
    { apiReplicas = 1, dbReplicas = 2, dbStorage = '10Gi', timezone = 'UTC' }: CentralServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:CentralServer', name, {}, opts);

    const dbReady = runPostgres({
      parent: this,
      name: 'central',
      replicas: dbReplicas,
      storage: dbStorage,
      timezone,
      affinities: {
        nodeSelector: {
          'bes.node.arch': 'amd64',
        },
      },
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

    this.tasksDeployment = runTasks({
      parent: this,
      podSpec,
      migratorJob,
      provisionerJob,
    });

    const { deployment, service } = runApi({
      parent: this,
      replicas: apiReplicas,
      podSpec,
      migratorJob,
      provisionerJob,
    });
    this.apiDeployment = deployment;

    this.apiService = runHaproxy('central', {
      parent: this,
      labels: {
        'app.kubernetes.io/name': 'central',
      },
      serviceName: 'central-lb',
      servers: [
        {
          port: 80,
          name: 'api',
          maxBackends: apiReplicas,
          serviceName: service.metadata.name,
          servicePortName: 'http',
        },
      ],
    }).service;
  }
}

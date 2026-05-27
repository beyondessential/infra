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
import {
  type ReplicaConfig,
  appVersion,
  BARMAN_BACKUP_BUCKET,
  BARMAN_BACKUP_ROLE_ARN,
  backupRetentionDays,
  backupsEnabled,
  dbBackups,
  dbExpose,
  dbStorage,
  normalizedStack,
  seedSnapshot,
  timezone,
} from '../config.ts';
import { namespace } from '../namespace.ts';
import { reportingRoles } from '../common/reportingRoles.ts';
import { cloneSeedSnapshot } from './seedSnapshot.ts';

export interface CentralServerArgs {
  fqdn: string;
  replicas: ReplicaConfig;
}

export class CentralServer extends ComponentResource {
  readonly fqdn: string;
  readonly ingress: k8s.apiextensions.CustomResource;
  readonly provisioning: Output<Provisioning>;
  readonly api: k8s.core.v1.Service;

  constructor(
    name: string,
    { fqdn, replicas }: CentralServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:CentralServer', name, {}, opts);
    this.fqdn = fqdn;

    const roles = reportingRoles({
      parent: this,
      server: 'central',
    });

    const seedSnapshotName = seedSnapshot
      ? cloneSeedSnapshot({ parent: this, namespace, appVersion })
      : undefined;

    const dbReady = runPostgres({
      parent: this,
      namespace,
      name: 'central',
      replicas: replicas.db,
      storage: dbStorage,
      timezone,
      backupSchedule: dbBackups,
      roles: roles.roles,
      initSql: roles.initSql,
      seedSnapshotName,
      barmanRoleArn: BARMAN_BACKUP_ROLE_ARN,
      barmanBackup: backupsEnabled
        ? { bucket: BARMAN_BACKUP_BUCKET, deployName: normalizedStack, retentionDays: backupRetentionDays }
        : undefined,
      inheritedMetadataLabels: { product: 'tamanu', stage: 'test' },
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
      rawSecret: roles.raw,
      reportingSecret: roles.reporting,
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

    this.api = api.service;

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

    if (dbExpose) {
      new k8s.core.v1.Service(
        'central-db-tailscale',
        {
          metadata: {
            namespace,
            annotations: {
              // k8s-pg and tamanu are the same length so we don't need to retruncate the name
              'tailscale.com/hostname': `k8s-pg-${normalizedStack}`,
              'tailscale.com/tags': 'tag:k8s-proxy,tag:server,tag:server-tamanu',
            },
          },
          spec: {
            type: 'LoadBalancer',
            loadBalancerClass: 'tailscale',
            selector: {
              'cnpg.io/cluster': 'central-db',
              'cnpg.io/instanceRole': 'primary',
            },
            allocateLoadBalancerNodePorts: false,
            ports: [
              {
                protocol: 'TCP',
                port: 5432,
                targetPort: 5432,
                name: 'postgresql',
              },
            ],
          },
        },
        { parent: this },
      );
    }
  }
}

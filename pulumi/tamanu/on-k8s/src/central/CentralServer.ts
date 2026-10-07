import { ComponentResource, type ComponentResourceOptions, Output, log } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { migrator } from '../common/migrator.ts';
import { runPostgres } from '../../../../common/k8s/postgres.ts';
import { templatedConfig } from '../common/templatedConfig.ts';
import { blobStoreVolume } from '../common/blobStore.ts';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.ts';
import { type Provisioning, provisioner } from './provisioner.ts';
import { runTasks } from './tasks.ts';
import { runApi } from './api.ts';
import { runFhirWorker } from './fhir.ts';
import { WebFrontend } from '../web/WebFrontend.ts';
import { ingress } from '../common/ingress.ts';
import {
  type ReplicaConfig,
  BARMAN_BACKUP_BUCKET,
  BARMAN_BACKUP_ROLE_ARN,
  atLeastVersion,
  backupRetentionDays,
  backupsEnabled,
  costLabels,
  dbAzColocate,
  dbDisruptionBudgets,
  dbMemory,
  dbExpose,
  dbExposeTags,
  dbStorage,
  nodeEnv,
  normalizedStack,
  releaseVersion,
  seedSnapshot,
  sharedBlobStorage,
  timezone,
} from '../config.ts';
import { namespace } from '../namespace.ts';
import { reportingRoles } from '../common/reportingRoles.ts';
import { reportingGrants } from '../common/reportingGrants.ts';
import { cloneSeedSnapshot, type SnapshotSource } from './seedSnapshot.ts';
import { seedTopUp } from './seedTopUp.ts';

export interface CentralServerArgs {
  fqdn: string;
  replicas: ReplicaConfig;
  seedSource?: SnapshotSource;
}

export class CentralServer extends ComponentResource {
  readonly fqdn: string;
  readonly ingress: k8s.apiextensions.CustomResource;
  readonly provisioning: Output<Provisioning>;
  readonly api: k8s.core.v1.Service;
  readonly apiDeployment: k8s.apps.v1.Deployment;

  constructor(
    name: string,
    { fqdn, replicas, seedSource }: CentralServerArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:tamanu:CentralServer', name, {}, opts);
    this.fqdn = fqdn;

    const roles = reportingRoles({
      parent: this,
      server: 'central',
    });

    const seedSnapshotName = seedSource
      ? cloneSeedSnapshot({ parent: this, namespace, source: seedSource })
      : undefined;

    const dbReady = runPostgres({
      parent: this,
      namespace,
      name: 'central',
      replicas: replicas.db,
      storage: dbStorage,
      timezone,
      colocateAz: dbAzColocate,
      disruptionBudgets: dbDisruptionBudgets,
      memoryRequest: dbMemory,
      roles: roles.roles,
      initSql: roles.initSql,
      seedSnapshotName,
      barmanRoleArn: BARMAN_BACKUP_ROLE_ARN,
      barmanBackup: backupsEnabled
        ? { bucket: BARMAN_BACKUP_BUCKET, deployName: normalizedStack, retentionDays: backupRetentionDays }
        : undefined,
      inheritedMetadataLabels: costLabels,
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
      blobStore: sharedBlobStorage
        ? blobStoreVolume('central', { parent: this, server: 'central' })
        : undefined,
    });

    // Reconcile reporting-role grants before the app boots (see reportingGrants.ts)
    reportingGrants('central', { parent: this, dbReady });

    const migratorJob = migrator('central', { parent: this, podSpec, appConfig });
    const { job: provisionerJob, provisioning } = provisioner({
      parent: this,
      podSpec,
      migratorJob,
    });
    this.provisioning = provisioning;

    if (seedSnapshot) {
      // The top-up hands the app the override that lets it write fake data, so the config
      // flag is the only thing standing between a real deployment and generated patients.
      // Refuse rather than skip: a stack that means to seed and has not said it is not
      // production should say so, not quietly get no data.
      if (nodeEnv === 'production') {
        throw new Error(
          'seedSnapshot writes fake clinical data, so it needs a stack whose nodeEnv is not production',
        );
      }
      // `generate seed` ships in Tamanu 2.65. A release branch cut before it has no such
      // subcommand, so the Job would exit 1 and take the whole deploy down with it; those
      // stacks keep whatever data the restored snapshot came with.
      if (atLeastVersion('2.65.0-0')) {
        seedTopUp({ parent: this, podSpec, provisionerJob });
      } else {
        log.warn(
          `Tamanu v${releaseVersion} has no \`generate seed\`; keeping the restored snapshot's data as-is`,
        );
      }
    }

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
    this.apiDeployment = api.deployment;

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
              'tailscale.com/tags': dbExposeTags,
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

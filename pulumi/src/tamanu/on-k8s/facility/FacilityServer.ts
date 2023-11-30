import { ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { runHaproxy } from '../common/haproxy.js';
import { runPostgres } from '../common/postgres.js';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.js';
import { RUN_ON_SPOT } from '../../../common/k8s/affinities.js';
import { templatedConfig } from '../common/templatedConfig.js';
import { migrator } from '../common/migrator.js';
import { CONFIG_FROM_ENV, podSpecFactory } from './specs.js';
import { runApi } from './api.js';

export interface FacilityServerArgs {
  centralApiService: k8s.core.v1.Service;
  facilityId: string;
  deviceId: string;
  dbReplicas?: number;
  dbStorage?: string;
  timezone?: string;
}

export class FacilityServer extends ComponentResource {
  readonly service: k8s.core.v1.Service;
  readonly deployment: k8s.apps.v1.Deployment;

  constructor(
    name: string,
    {
      centralApiService,
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
      affinities: {
        nodeSelector: {
          // Because we colocate the database with the facility server, we stick
          // to the same architecture, until we can build for arm64.
          'bes.node.arch': 'amd64',
        },
        additionalPodAntiAffinity: {
          // Spread out the database pods across nodes by trying to avoid
          // nodes that already have databases in this namespace.
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 20,
              podAffinityTerm: {
                topologyKey: 'kubernetes.io/hostname',
                labelSelector: {
                  matchExpressions: [
                    {
                      key: 'namespace',
                      operator: 'In',
                      values: [namespace],
                    },
                    {
                      key: 'app.kubernetes.io/component',
                      operator: 'In',
                      values: ['database'],
                    },
                  ],
                },
              },
            },
          ],
        },
        tolerations: [CAN_RUN_ON_SPOT],
        nodeAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 1,
              preference: RUN_ON_SPOT,
            },
          ],
        },
      },
    });

    const appConfig = templatedConfig({
      parent: this,
      kind: 'config-facility',
      name: `facility-${name}`,
      additionalData: {
        'custom-environment-variables.json': JSON.stringify(CONFIG_FROM_ENV),
      },
    });

    const podSpec = podSpecFactory({
      name,
      timezone,
      appConfig: appConfig.metadata.name,
      dbReady,
      facilityId,
      deviceId,
      centralApiService,
    });

    const migratorJob = migrator(`facility-${name}`, {
      parent: this,
      podSpec,
      appConfig,
    });

    const { deployment, service } = runApi(name, {
      parent: this,
      deviceId,
      podSpec,
      migratorJob,
    });
    this.deployment = deployment;

    this.service = runHaproxy(`facility-${name}`, {
      parent: this,
      labels: {
        'app.kubernetes.io/name': 'facility',
        'app.kubernetes.io/deviceId': deviceId,
      },
      serviceName: `facility-${name}-lb`,
      servers: [
        {
          port: 80,
          name: 'api',
          maxBackends: 1,
          serviceName: service.metadata.name,
          servicePortName: 'http',
        },
      ],
    }).service;
  }
}

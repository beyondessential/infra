import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import {
  DAGSTER_COMPUTE_LOGS_PREFIX,
  DAGSTER_SERVICE_ACCOUNT,
} from '../../../constants/dagster.ts';
import { userDeploymentsValues } from './codeLocations.ts';
import { registrySecret } from './secrets.ts';
import {
  awsRegion,
  computeLogsBucket,
  cpuRequest,
  dagsterChartVersion,
  dbDatabase,
  dbHost,
  dbIamAuth,
  dbPassword,
  dbPort,
  dbUser,
  memoryRequest,
  runPodCpuRequest,
  runPodMemoryRequest,
} from './config.ts';
import { SPOT_PREFERRED_AFFINITY, SPOT_TOLERATIONS } from './scheduling.ts';

// Release name, and so the prefix of the webserver Service that ingress.ts names.
export const releaseName = 'dagster';

const imagePullSecrets = registrySecret ? [{ name: registrySecret.metadata.name }] : [];

// spec: DAGS#storage
const storageAuth = dbIamAuth
  ? { authProvider: { type: 'aws_wif', awsRegion } }
  : { postgresqlPassword: dbPassword };

// spec: DAGS#run-launcher
new k8s.helm.v3.Release(releaseName, {
  name: releaseName,
  chart: 'dagster',
  version: dagsterChartVersion,
  repositoryOpts: { repo: 'https://dagster-io.github.io/helm' },
  namespace,
  values: {
    global: {
      serviceAccountName: DAGSTER_SERVICE_ACCOUNT,
      postgresqlAuthWifEnabled: dbIamAuth,
    },
    imagePullSecrets,
    dagsterWebserver: {
      resources: { requests: { cpu: cpuRequest, memory: memoryRequest } },
      affinity: SPOT_PREFERRED_AFFINITY,
      tolerations: SPOT_TOLERATIONS,
    },
    dagsterDaemon: {
      resources: { requests: { cpu: cpuRequest, memory: memoryRequest } },
      affinity: SPOT_PREFERRED_AFFINITY,
      tolerations: SPOT_TOLERATIONS,
      runCoordinator: {
        enabled: true,
        type: 'QueuedRunCoordinator',
        config: {
          queuedRunCoordinator: {
            maxConcurrentRuns: 2,
            tagConcurrencyLimits: [
              { key: 'dagster/backfill', limit: 1 },
              { key: 'processing_load', value: 'heavy', limit: 1 },
              {
                key: 'database',
                value: { applyLimitPerUniqueValue: true },
                limit: 1,
              },
            ],
          },
        },
      },
      runMonitoring: { enabled: true },
      runRetries: { enabled: true, maxRetries: 1 },
    },
    retention: {
      enabled: true,
      schedule: { purgeAfterDays: 14 },
      sensor: { purgeAfterDays: { skipped: 1, failure: 1, success: 7 } },
      autoMaterialize: { purgeAfterDays: 7 },
    },
    postgresql: {
      enabled: false,
      postgresqlHost: dbHost,
      postgresqlUsername: dbUser,
      postgresqlDatabase: dbDatabase,
      service: { port: dbPort },
      ...storageAuth,
    },
    // spec: DAGS#compute-logs
    computeLogManager: {
      type: 'S3ComputeLogManager',
      config: {
        s3ComputeLogManager: {
          bucket: computeLogsBucket,
          prefix: DAGSTER_COMPUTE_LOGS_PREFIX,
        },
      },
    },
    runLauncher: {
      type: 'K8sRunLauncher',
      config: {
        k8sRunLauncher: {
          resources: { requests: { cpu: runPodCpuRequest, memory: runPodMemoryRequest } },
          // On-demand only: a spot reclaim mid-run would spend the run's one retry.
          runK8sConfig: {
            podSpecConfig: {
              nodeSelector: {
                'bes.node.purpose': 'workload',
                'bes.node.schedule': 'ondemand',
                'bes.node.arch': 'amd64',
              },
            },
          },
        },
      },
    },
    'dagster-user-deployments': {
      enabled: true,
      enableSubchart: true,
      imagePullSecrets,
      deployments: userDeploymentsValues,
    },
  },
});

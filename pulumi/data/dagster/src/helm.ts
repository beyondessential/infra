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
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';

// Release name, and so the prefix of the webserver Service that ingress.ts names.
export const releaseName = 'dagster';

const SPOT_PREFERRED_AFFINITY = {
  nodeAffinity: {
    preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 1, preference: RUN_ON_SPOT }],
    requiredDuringSchedulingIgnoredDuringExecution: {
      nodeSelectorTerms: [
        { matchExpressions: [purposeAffinity('workload'), archAffinity('amd64')] },
      ],
    },
  },
};
const SPOT_TOLERATIONS = [CAN_RUN_ON_SPOT];

const imagePullSecrets = registrySecret ? [{ name: registrySecret.metadata.name }] : [];

// spec: DAGS#storage
const storageAuth = dbPassword
  ? { postgresqlPassword: dbPassword }
  : { authProvider: { type: 'aws_wif', awsRegion } };

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

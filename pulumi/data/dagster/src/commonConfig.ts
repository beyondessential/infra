import * as k8s from '@pulumi/kubernetes';
import YAML from 'yaml';
import { system } from './namespace.ts';
import { appLabels } from './labels.ts';
import { HOME } from './config.ts';
import { redis } from './redis.ts';
import { interpolate } from '@pulumi/pulumi';

export const commonConfig = new k8s.core.v1.ConfigMap('dagster-common', {
  metadata: {
    namespace: system,
    labels: appLabels('common'),
  },
  data: {
    'dagster.yaml': YAML.stringify({
      schedule_storage: {
        module: 'dagster_postgres.schedule_storage',
        class: 'PostgresScheduleStorage',
      },
      run_storage: {
        module: 'dagster_postgres.run_storage',
        class: 'PostgresRunStorage',
      },
      event_log_storage: {
        module: 'dagster_postgres.event_log',
        class: 'PostgresEventLogStorage',
      },
      // https://docs.dagster.io/deployment/oss/oss-instance-configuration#run-coordinator
      run_coordinator: {
        module: 'dagster.core.run_coordinator',
        class: 'QueuedRunCoordinator',
      },
      compute_logs: {
        module: 'dagster.core.storage.local_compute_log_manager',
        class: 'LocalComputeLogManager',
        config: {
          base_dir: '/mnt/logs',
        },
      },
      local_artifact_storage: {
        module: 'dagster.core.storage.root',
        class: 'LocalArtifactStorage',
        config: {
          base_dir: '/mnt/artifacts',
        },
      },
      // https://docs.dagster.io/api/libraries/dagster-celery-k8s#dagster_celery_k8s.CeleryK8sRunLauncher
      run_launcher: {
        module: 'dagster_k8s.launcher',
        class: 'CeleryK8sRunLauncher',
        config: {
          dagster_home: HOME,
          instance_config_map: {
            // the name of this very configmap
            env: 'DAGSTER_COMMON_CONFIG_MAP',
          },
          postgres_password_secret: 'TODO',
          broker: interpolate`redis://${redis.metadata.name}/0`,
          backend: interpolate`redis://${redis.metadata.name}/1`,
        },
      },
    }),
  },
});

import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { PodSpecFactory, appLabels, appSelector } from './specs.js';

export interface RunTasksArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
  provisionerJob: k8s.batch.v1.Job;
}

export function runTasks({
  parent,
  podSpec,
  migratorJob,
  provisionerJob,
}: RunTasksArgs): k8s.apps.v1.Deployment {
  return new k8s.apps.v1.Deployment(
    'central-tasks',
    {
      metadata: {
        namespace,
      },
      spec: {
        replicas: 1,
        strategy: {
          // Stop the old before starting the new, to avoid doubling up on sync
          type: 'Recreate',
        },
        selector: {
          matchLabels: appSelector('task-runner'),
        },
        template: {
          metadata: {
            labels: appLabels('task-runner'),
          },
          spec: {
            ...podSpec('task-runner', ['tasks']),
          },
        },
      },
    },
    { parent, dependsOn: [migratorJob, provisionerJob] },
  );
}

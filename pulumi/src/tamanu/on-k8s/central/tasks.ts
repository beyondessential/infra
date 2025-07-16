import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import { appLabels, appSelector } from './specs.ts';
import { PodSpecFactory } from '../common/specFactory.ts';

export interface RunTasksArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
  provisionerJob: k8s.batch.v1.Job;
  enabled: boolean;
}

export function runTasks({
  parent,
  podSpec,
  migratorJob,
  provisionerJob,
  enabled,
}: RunTasksArgs): k8s.apps.v1.Deployment {
  return new k8s.apps.v1.Deployment(
    'central-tasks',
    {
      metadata: {
        namespace,
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        replicas: enabled ? 1 : 0,
        strategy: {
          // Avoid double-running scheduled tasks
          type: 'Recreate',
        },
        selector: {
          matchLabels: appSelector('task-runner'),
        },
        template: {
          metadata: {
            labels: appLabels('task-runner'),
          },
          spec: podSpec({ podType: 'task-runner', command: ['tasks'] }),
        },
      },
    },
    { parent, dependsOn: [migratorJob, provisionerJob] },
  );
}

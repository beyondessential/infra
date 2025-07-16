import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import { appLabels, appSelector } from './specs.ts';
import type { PodSpecFactory } from '../common/specFactory.ts';

export interface RunTasksArgs {
  parent: ComponentResource;
  deviceId: string;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
}

export function runTasks(
  name: string,
  { parent, deviceId, podSpec, migratorJob }: RunTasksArgs,
): k8s.apps.v1.Deployment {
  return new k8s.apps.v1.Deployment(
    `facility-${name}-tasks`,
    {
      metadata: {
        namespace,
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        replicas: 1,
        strategy: {
          // Stop the old before starting the new, to avoid doubling up on sync
          type: 'Recreate',
        },
        selector: {
          matchLabels: appSelector('task-runner', deviceId),
        },
        template: {
          metadata: {
            labels: appLabels('task-runner', deviceId),
          },
          spec: podSpec({ podType: 'task-runner', command: ['startTasks'] }),
        },
      },
    },
    { parent, dependsOn: [migratorJob] },
  );
}

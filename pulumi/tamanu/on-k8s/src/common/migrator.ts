import { ComponentResource, type Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import type { PodSpecFactory } from './specFactory.ts';

export interface MigratorArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  appConfig: Input<k8s.core.v1.ConfigMap>;
}

export function migrator(
  name: string,
  { parent, podSpec, appConfig }: MigratorArgs,
): k8s.batch.v1.Job {
  return new k8s.batch.v1.Job(
    `${name}-migrator`,
    {
      metadata: {
        namespace,
      },
      spec: {
        backoffLimit: 5,
        template: {
          spec: {
            ...podSpec({ podType: 'migrator', command: ['migrate'] }),
            restartPolicy: 'Never',
          },
        },
      },
    },
    {
      parent,
      dependsOn: [appConfig],
      // Jobs are immutable, so every image bump replaces this one. Without
      // this, Pulumi creates the replacement first and defers deleting the old
      // Job to the end of the update; an update that fails part-way (an
      // exhausted backoffLimit here does exactly that) never reaches the
      // delete, stranding the old Job in both state and the cluster, one per
      // bump. Deleting first means a failed update strands nothing.
      deleteBeforeReplace: true,
      // to force re-run if it fails in a previous up
      // disabled: causes a re-run on every up, which is annoying and
      // wasteful. TODO: figure out how to do a re-run only if on a
      // previous up it failed.
      // replaceOnChanges: ['*'],
    },
  );
}

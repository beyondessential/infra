import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.js';
import { PodSpecFactory } from '../facility/specs.js';

export interface MigratorArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  appConfig: k8s.core.v1.ConfigMap;
}

export function migrator(name: string, { parent, podSpec, appConfig }: MigratorArgs): k8s.batch.v1.Job {
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
            ...podSpec('migrator', ['migrate']),
            restartPolicy: 'Never',
          },
        },
      },
    },
    {
      parent,
      dependsOn: [appConfig],
      // to force re-run if it fails in a previous up
      // disabled: causes a re-run on every up, which is annoying and
      // wasteful. TODO: figure out how to do a re-run only if on a
      // previous up it failed.
      // replaceOnChanges: ['*'],
    },
  );
}

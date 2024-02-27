import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { templatedConfig } from '../common/templatedConfig.js';
import { namespace } from '../namespace.js';
import { PodSpecFactory } from '../common/specFactory.js';

export interface MigratorArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
}

export function provisioner({ parent, podSpec, migratorJob }: MigratorArgs): k8s.batch.v1.Job {
  const provisioningConfig = templatedConfig({
    parent: this,
    kind: 'provisioning',
    name: 'provisioning',
  });

  return new k8s.batch.v1.Job(
    'central-provisioner',
    {
      metadata: {
        namespace,
      },
      spec: {
        backoffLimit: 2,
        template: {
          spec: {
            ...podSpec({
              podType: 'provisioner',
              command: ['provision', '--skip-if-not-needed', '/provisioning/provisioning.json'],
              containerArgs: {
                volumeMounts: [
                  {
                    name: 'provisioning-volume',
                    mountPath: '/provisioning',
                  },
                ],
              },
              volumes: [
                {
                  name: 'provisioning-volume',
                  configMap: {
                    name: provisioningConfig.metadata.name,
                  },
                },
              ],
            }),
            restartPolicy: 'Never',
          },
        },
      },
    },
    {
      parent,
      dependsOn: [migratorJob],
      // to force re-run if it fails in a previous up
      // disabled: causes a re-run on every up, which is annoying and
      // wasteful. TODO: figure out how to do a re-run only if on a
      // previous up it failed.
      // replaceOnChanges: ['*'],
    },
  );
}

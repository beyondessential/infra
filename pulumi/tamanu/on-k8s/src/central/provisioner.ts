import { ComponentResource, type Output } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import JSON5 from 'json5';
import { templatedConfig } from '../common/templatedConfig.ts';
import { BLOB_STORE_ROOT } from '../common/blobStore.ts';
import { namespace } from '../namespace.ts';
import type { PodSpecFactory } from '../common/specFactory.ts';
import { facilityIds, sharedBlobStorage, timezone } from '../config.ts';

export interface MigratorArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
}

type Settings = { [key: string]: string | { [key: string]: string } };

export interface Provisioning {
  users: {
    [email: string]: {
      password: string;
      role?: string;
    };
  };
  settings: {
    global: Settings;
    central: Settings;
    facilities: {
      [facilityId: string]: Settings;
    };
  };
}

export function provisioner({ parent, podSpec, migratorJob }: MigratorArgs): {
  job: k8s.batch.v1.Job;
  provisioning: Output<Provisioning>;
} {
  const provisioningConfig = templatedConfig({
    parent: this,
    kind: 'provisioning',
    name: 'provisioning',
    additionalData: {
      timezone,
    },
    templateData: {
      // The in-cluster template iterates this as facility ids, using each as
      // both the key and the facility code, so it takes ids and not host labels.
      facilityNames: facilityIds,
      blobStoreRoot: sharedBlobStorage ? BLOB_STORE_ROOT : undefined,
    },
  });

  const liveData = k8s.core.v1.ConfigMap.get('actual-provisioning', provisioningConfig.id, {
    parent: provisioningConfig,
  });

  const provisioning = liveData.data.apply((data) => {
    for (const key of ['provisioning.json5', 'provisioning.json']) {
      if (data[key]) {
        return JSON5.parse(data[key]) as Provisioning;
      }
    }

    throw new Error('No provisioning data found');
  });

  const job = new k8s.batch.v1.Job(
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
              command: ['provision', '--skip-if-not-needed', '/provisioning/provisioning.json5'],
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
      // Delete the superseded Job before creating its replacement; see the
      // note in common/migrator.ts for why deferring it strands Jobs.
      deleteBeforeReplace: true,
      // to force re-run if it fails in a previous up
      // disabled: causes a re-run on every up, which is annoying and
      // wasteful. TODO: figure out how to do a re-run only if on a
      // previous up it failed.
      // replaceOnChanges: ['*'],
    },
  );

  return { job, provisioning };
}

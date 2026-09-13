import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import type { PodSpecFactory } from '../common/specFactory.ts';

const ROUNDS = 3;

export interface SeedTopUpArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  provisionerJob: k8s.batch.v1.Job;
}

// A seed snapshot holds only the data types its own version's generator knew about, so
// anything added since has no rows until this runs against the restored database.
export function seedTopUp({ parent, podSpec, provisionerJob }: SeedTopUpArgs): k8s.batch.v1.Job {
  return new k8s.batch.v1.Job(
    'central-seed-top-up',
    {
      metadata: {
        namespace,
      },
      spec: {
        backoffLimit: 1,
        template: {
          spec: {
            ...podSpec({
              podType: 'seed-top-up',
              command: ['generate', 'seed', '--rounds', String(ROUNDS)],
              // The command refuses to write fake data without this, since the same image
              // runs on hospital servers.
              env: [{ name: 'TAMANU_ALLOW_FAKE_DATA', value: 'true' }],
            }),
            restartPolicy: 'Never',
          },
        },
      },
    },
    {
      parent,
      dependsOn: [provisionerJob],
      // Same reasoning as common/migrator.ts: replace by deleting first so a
      // failed update never strands the superseded Job.
      deleteBeforeReplace: true,
    },
  );
}

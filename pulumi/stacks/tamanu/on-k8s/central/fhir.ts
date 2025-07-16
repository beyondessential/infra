import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import { appLabels, appSelector } from './specs.ts';
import type { PodSpecFactory } from '../common/specFactory.ts';

export interface RunFhirWorkerArgs {
  parent: ComponentResource;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
  provisionerJob: k8s.batch.v1.Job;
  name: string;
  topics?: string[];
  replicas?: number;
}

export function runFhirWorker({
  parent,
  podSpec,
  migratorJob,
  provisionerJob,
  name,
  topics,
  replicas = 1,
}: RunFhirWorkerArgs): k8s.apps.v1.Deployment {
  return new k8s.apps.v1.Deployment(
    `central-fhir-${name}`,
    {
      metadata: {
        namespace,
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        replicas,
        selector: {
          matchLabels: appSelector(`fhir-${name}`),
        },
        template: {
          metadata: {
            labels: appLabels(`fhir-${name}`),
          },
          spec: podSpec({
            podType: `fhir-${name}`,
            command: topics
              ? ['startFhirWorker', '--topics', topics.join(',')]
              : ['startFhirWorker'],
          }),
        },
      },
    },
    { parent, dependsOn: [migratorJob, provisionerJob] },
  );
}

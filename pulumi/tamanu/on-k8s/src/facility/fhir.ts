import { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from '../namespace.ts';
import { appLabels, appSelector } from './specs.ts';
import type { PodSpecFactory } from '../common/specFactory.ts';
import { costLabels } from '../config.ts';

export interface RunFhirWorkerArgs {
  parent: ComponentResource;
  name: string;
  deviceId: string;
  podSpec: PodSpecFactory;
  migratorJob: k8s.batch.v1.Job;
  topics?: string[];
}

export function runFhirWorker({
  parent,
  name,
  deviceId,
  podSpec,
  migratorJob,
  topics,
}: RunFhirWorkerArgs): k8s.apps.v1.Deployment {
  return new k8s.apps.v1.Deployment(
    `facility-${name}-fhir-${deviceId}`,
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
          type: 'Recreate',
        },
        selector: {
          matchLabels: appSelector(`fhir-${name}`, deviceId),
        },
        template: {
          metadata: {
            labels: { ...appLabels(`fhir-${name}`, deviceId), ...costLabels },
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
    { parent, dependsOn: [migratorJob] },
  );
}

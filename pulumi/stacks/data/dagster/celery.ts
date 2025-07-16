import { ComponentResource, type ComponentResourceOptions, type Output } from '@pulumi/pulumi';
import YAML from 'yaml';
import * as k8s from '@pulumi/kubernetes';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { dagsterVersion, HOME } from './config.ts';
import { appLabels, appSelector } from './labels.ts';
import { sa } from './serviceAccount.ts';

export interface CeleryQueueArgs {
  replicas?: number;
  namespace: Output<string>;
}

export class CeleryQueue extends ComponentResource {
  constructor(
    name: string,
    { replicas = 2, namespace }: CeleryQueueArgs,
    opts: ComponentResourceOptions = {},
  ) {
    super('bes:dagster:CeleryQueue', name, {}, opts);

    const labels = appLabels(`celery-${name}`);
    const selector = appSelector(`celery-${name}`);

    const worker = new k8s.core.v1.ConfigMap(
      `celery-${name}`,
      {
        metadata: {
          namespace,
          labels,
        },
        data: {
          'celery.yaml': YAML.stringify({
            execution: {
              celery: {
                broker: {
                  env: 'DAGSTER_CELERY_BROKER_URL',
                },
                backend: {
                  env: 'DAGSTER_CELERY_BACKEND_URL',
                },
              },
            },
          }),
        },
      },
      { parent: this },
    );

    new k8s.apps.v1.Deployment(`celery-${name}`, {
      metadata: {
        namespace,
        annotations: {
          'pulumi.com/patchForce': 'true',
        },
      },
      spec: {
        replicas,
        selector: {
          matchLabels: selector,
        },
        template: {
          metadata: {
            labels,
          },
          spec: {
            serviceAccountName: sa.metadata.name,
            automountServiceAccountToken: true,
            tolerations: [CAN_RUN_ON_SPOT],
            affinity: {
              nodeAffinity: {
                preferredDuringSchedulingIgnoredDuringExecution: [
                  {
                    weight: 1,
                    preference: RUN_ON_SPOT,
                  },
                ],
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms: [
                    {
                      matchExpressions: [archAffinity('amd64'), purposeAffinity('workload')],
                    },
                  ],
                },
              },
            },
            volumes: [
              {
                name: 'instance',
                configMap: {
                  name: dagsterConfig.metadata.name,
                },
              },
              {
                name: 'celery',
                configMap: {
                  name: worker.metadata.name,
                },
              },
            ],
            containers: [
              {
                name: 'server',
                image: `dagster/dagster-celery-k8s:${dagsterVersion}`,
                imagePullPolicy: dagsterVersion === 'latest' ? 'Always' : 'IfNotPresent',
                command: ['dagster-celery'],
                args: [
                  'worker',
                  'start',
                  '-A',
                  'dagster_celery_k8s.app',
                  '-y',
                  `${HOME}/celery-config.yaml`,
                  '-q',
                  name,
                ],
                // TODO: env from secrets for postgres (DAGSTER_PG_PASSWORD) and redis (see configmap)
                volumeMounts: [
                  {
                    name: 'instance',
                    mountPath: `${HOME}/dagster.yaml`,
                    subPath: 'dagster.yaml',
                  },
                  {
                    name: 'celery',
                    mountPath: `${HOME}/celery-config.yaml`,
                    subPath: 'celery.yaml',
                  },
                ],
                resources: {
                  limits: {
                    cpu: '100m',
                    memory: '128Mi',
                  },
                  requests: {
                    cpu: '100m',
                    memory: '128Mi',
                  },
                },
                livenessProbe: {
                  exec: {
                    command: [
                      '/bin/sh',
                      '-c',
                      `dagster-celery status -A dagster_celery_k8s.app -y ${HOME}/celery-config.yaml | grep "\${HOSTNAME}:.*OK"`,
                    ],
                  },
                  initialDelaySeconds: 15,
                  periodSeconds: 10,
                  timeoutSeconds: 10,
                  successThreshold: 1,
                  failureThreshold: 3,
                },
              },
            ],
          },
        },
      },
    });
  }
}

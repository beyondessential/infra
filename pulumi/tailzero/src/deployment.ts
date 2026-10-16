import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { secret } from './secrets.ts';
import {
  image,
  architecture,
  storageSize,
  storageClassName,
  cpuRequest,
  memoryRequest,
  cpuLimit,
  memoryLimit,
} from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';

const pvc = new k8s.core.v1.PersistentVolumeClaim('tailzero', {
  metadata: {
    namespace,
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    storageClassName,
    resources: {
      requests: {
        storage: storageSize,
      },
    },
  },
});

export const deployment = new k8s.apps.v1.Deployment('tailzero', {
  metadata: {
    namespace,
    name: 'tailzero',
  },
  spec: {
    replicas: 1,
    strategy: {
      // Single instance owns the ReadWriteOnce volume; don't run two at once.
      type: 'Recreate',
    },
    selector: {
      matchLabels: labels,
    },
    template: {
      metadata: {
        labels,
      },
      spec: {
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
                  matchExpressions: [purposeAffinity('workload'), archAffinity(architecture)],
                },
              ],
            },
          },
        },
        volumes: [
          {
            name: 'state',
            persistentVolumeClaim: {
              claimName: pvc.metadata.name,
            },
          },
        ],
        containers: [
          {
            name: 'tailzero',
            image,
            imagePullPolicy: 'Always',
            // The invite code is only passed while the secret is set (first-run
            // enrollment); once unset, the connector runs off persisted state.
            ...(secret
              ? {
                  args: ['--border0-invite-code', '$(BORDER0_INVITE_CODE)'],
                  env: [
                    {
                      name: 'BORDER0_INVITE_CODE',
                      valueFrom: {
                        secretKeyRef: {
                          name: secret.metadata.name,
                          key: 'BORDER0_INVITE_CODE',
                        },
                      },
                    },
                  ],
                }
              : {}),
            volumeMounts: [
              {
                name: 'state',
                mountPath: '/var/lib/tailzero',
              },
            ],
            resources: {
              requests: {
                cpu: cpuRequest,
                memory: memoryRequest,
              },
              ...(cpuLimit || memoryLimit
                ? {
                    limits: {
                      ...(cpuLimit ? { cpu: cpuLimit } : {}),
                      ...(memoryLimit ? { memory: memoryLimit } : {}),
                    },
                  }
                : {}),
            },
          },
        ],
      },
    },
  },
});

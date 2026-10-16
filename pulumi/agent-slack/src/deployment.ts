import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { labels } from './labels.ts';
import { secret, registrySecret } from './secrets.ts';
import {
  image,
  replicas,
  architecture,
  cpuRequest,
  memoryRequest,
  cpuLimit,
  memoryLimit,
} from './config.ts';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';

export const deployment = new k8s.apps.v1.Deployment('agent-slack', {
  metadata: {
    namespace,
    name: 'agent-slack',
  },
  spec: {
    replicas,
    strategy: {
      type: 'Recreate', // Only one instance should run at a time to avoid duplicate messages
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
        imagePullSecrets: [
          { name: registrySecret.metadata.name },
        ],
        containers: [
          {
            name: 'agent',
            image,
            imagePullPolicy: 'Always',
            command: ['python', '-u', '-m', 'src.agent'],
            envFrom: [
              {
                secretRef: {
                  name: secret.metadata.name,
                },
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

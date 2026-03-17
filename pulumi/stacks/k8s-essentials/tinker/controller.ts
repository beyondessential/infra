import * as k8s from '@pulumi/kubernetes';
import { image } from './config.ts';
import { controllerLabels } from './labels.ts';
import { serviceAccount } from './rbac.ts';
import { purposeAffinity } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';

export const controller = new k8s.apps.v1.Deployment('tinker-controller', {
  metadata: {
    name: 'tinker-controller',
    namespace: 'tinker-system',
  },
  spec: {
    replicas: 1,
    strategy: {
      type: 'Recreate',
    },
    selector: {
      matchLabels: controllerLabels,
    },
    template: {
      metadata: {
        labels: controllerLabels,
      },
      spec: {
        serviceAccountName: serviceAccount.metadata.name,
        tolerations: [CAN_RUN_ON_SPOT],
        affinity: {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [purposeAffinity('workload')],
                },
              ],
            },
          },
        },
        containers: [
          {
            name: 'controller',
            image,
            command: ['/usr/local/bin/tinker-controller'],
            env: [
              {
                name: 'GATEWAY_URL',
                value: 'http://tinker-gateway-internal.tinker-system:8081',
              },
            ],
            resources: {
              requests: {
                cpu: '10m',
                memory: '64Mi',
              },
            },
          },
        ],
      },
    },
  },
});

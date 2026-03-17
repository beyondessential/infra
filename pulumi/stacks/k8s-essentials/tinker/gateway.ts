import * as k8s from '@pulumi/kubernetes';
import { image, gatewayReplicas, databaseName, tailscaleIngressUrl } from './config.ts';
import { gatewayLabels } from './labels.ts';
import { dbCluster } from './database.ts';
import { purposeAffinity } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';

export const gateway = new k8s.apps.v1.Deployment('tinker-gateway', {
  metadata: {
    name: 'tinker-gateway',
    namespace: 'tinker-system',
  },
  spec: {
    replicas: gatewayReplicas,
    strategy: {
      type: 'RollingUpdate',
    },
    selector: {
      matchLabels: gatewayLabels,
    },
    template: {
      metadata: {
        labels: gatewayLabels,
      },
      spec: {
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
            name: 'gateway',
            image,
            command: ['/usr/local/bin/tinker-gateway'],
            env: [
              {
                name: 'DATABASE_URL',
                valueFrom: {
                  secretKeyRef: {
                    name: dbCluster.metadata.apply((m) => `${m.name}-app`),
                    key: 'uri',
                  },
                },
              },
              {
                name: 'TAILSCALE_INGRESS_URL',
                value: tailscaleIngressUrl,
              },
            ],
            ports: [
              { containerPort: 8080, name: 'public' },
              { containerPort: 8081, name: 'internal' },
            ],
            resources: {
              requests: {
                cpu: '50m',
                memory: '128Mi',
              },
            },
          },
        ],
      },
    },
  },
});

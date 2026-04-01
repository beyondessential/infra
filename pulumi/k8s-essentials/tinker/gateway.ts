import * as k8s from '@pulumi/kubernetes';
import { image, gatewayReplicas, gatewayTailscaleName } from './config.ts';
import { gatewayLabels } from './labels.ts';
import { dbReady } from './database.ts';
import { PostgresUrlSecretKey } from '../../common/k8s/postgresUrl.ts';
import { purposeAffinity } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { namespace } from './namespace.ts';

export const gateway = new k8s.apps.v1.Deployment('tinker-gateway', {
  metadata: {
    namespace,
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
                  secretKeyRef: dbReady.apply((secret) => ({
                    name: secret.metadata.name,
                    key: PostgresUrlSecretKey.AppDbUrl,
                  })),
                },
              },
              {
                name: 'TAILSCALE_INGRESS_URL',
                value: `http://${gatewayTailscaleName}`,
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

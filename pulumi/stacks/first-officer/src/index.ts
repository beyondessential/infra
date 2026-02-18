import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster, cfg } from '../../common/k8s/coreRef.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../common/k8s/affinities.ts';
import { image } from './config.ts';

await failIfIncorrectCluster();

const APP_NAME = 'first-officer';

const ns = new k8s.core.v1.Namespace('first-officer', {
  metadata: {
    name: cfg.get('namespace') ?? APP_NAME,
  },
});
export const namespace = ns.metadata.name;

const labels = {
  'app.kubernetes.io/name': APP_NAME,
};

new k8s.apps.v1.Deployment('api', {
  metadata: {
    namespace,
    name: 'api',
  },
  spec: {
    replicas: 1,
    strategy: { type: 'Recreate' },
    selector: { matchLabels: labels },
    template: {
      metadata: { labels },
      spec: {
        tolerations: [CAN_RUN_ON_SPOT],
        affinity: {
          nodeAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [
              { weight: 1, preference: RUN_ON_SPOT },
            ],
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [purposeAffinity('workload'), archAffinity('arm64')],
                },
              ],
            },
          },
        },
        containers: [
          {
            name: 'api',
            image,
            ports: [{ containerPort: 4141, name: 'http' }],
            resources: {
              requests: {
                cpu: '10m',
                memory: '10Mi',
              },
              limits: {
                // memory: '50Mi',
              },
            },
            livenessProbe: {
              httpGet: { path: '/', port: 4141 },
              initialDelaySeconds: 15,
              periodSeconds: 30,
            },
          },
        ],
      },
    },
  },
});

const svc = new k8s.core.v1.Service('api', {
  metadata: {
    name: 'api',
    namespace,
  },
  spec: {
    selector: labels,
    ports: [{ port: 80, targetPort: 4141, protocol: 'TCP', name: 'http' }],
  },
});

new k8s.networking.v1.Ingress('tailscale', {
  metadata: {
    namespace,
    annotations: {
      'tailscale.com/hostname': 'first-officer',
      'tailscale.com/tags': 'tag:k8s,tag:k8s-ai',
    },
  },
  spec: {
    ingressClassName: 'tailscale',
    tls: [{ hosts: ['first-officer'] }],
    rules: [
      {
        host: 'first-officer',
        http: {
          paths: [
            {
              path: '/',
              pathType: 'Prefix',
              backend: {
                service: {
                  name: svc.metadata.name,
                  port: {
                    name: 'http',
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
});

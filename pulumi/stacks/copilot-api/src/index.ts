import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster, cfg } from '../../common/k8s/coreRef.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../common/k8s/affinities.ts';
import { image, ghToken, port } from './config.ts';

await failIfIncorrectCluster();

const ns = new k8s.core.v1.Namespace('copilot-api', {
  metadata: {
    name: cfg.get('namespace') ?? 'copilot-api',
  },
});
export const namespace = ns.metadata.name;

const labels = {
  'app.kubernetes.io/name': 'copilot-api',
};

const secret = new k8s.core.v1.Secret('copilot-api', {
  metadata: { namespace },
  stringData: {
    GH_TOKEN: ghToken,
  },
});

const pvc = new k8s.core.v1.PersistentVolumeClaim('copilot-api', {
  metadata: { namespace },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: {
      requests: {
        storage: '1Gi',
      },
    },
  },
});

new k8s.apps.v1.Deployment('copilot-api', {
  metadata: {
    namespace,
    name: 'copilot-api',
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
        volumes: [
          {
            name: 'data',
            persistentVolumeClaim: { claimName: pvc.metadata.name },
          },
        ],
        containers: [
          {
            name: 'copilot-api',
            image,
            imagePullPolicy: 'Always',
            ports: [{ containerPort: port, name: 'http' }],
            envFrom: [
              {
                secretRef: { name: secret.metadata.name },
              },
            ],
            volumeMounts: [
              {
                name: 'data',
                mountPath: '/root/.local/share/copilot-api',
              },
            ],
            resources: {
              requests: {
                cpu: '10m',
                memory: '128Mi',
              },
              limits: {
                memory: '512Mi',
              },
            },
            livenessProbe: {
              httpGet: { path: '/', port },
              initialDelaySeconds: 15,
              periodSeconds: 30,
            },
          },
        ],
      },
    },
  },
});

new k8s.core.v1.Service('copilot-api', {
  metadata: {
    name: 'copilot-api',
    namespace,
    annotations: {
      'tailscale.com/expose': 'true',
    },
  },
  spec: {
    selector: labels,
    ports: [{ port: 80, targetPort: port, protocol: 'TCP' }],
  },
});

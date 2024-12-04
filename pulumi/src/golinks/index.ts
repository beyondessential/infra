import * as k8s from '@pulumi/kubernetes';
import { DeviceKey, TailnetKey, getDeviceOutput } from '@pulumi/tailscale';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../common/k8s/affinities.js';
import { failIfIncorrectCluster } from '../common/k8s/coreRef.js';
import { tailscaleKey } from '../common/tailscaleKey.js';
await failIfIncorrectCluster();

const ns = new k8s.core.v1.Namespace('golinks', {
  metadata: {
    name: 'golinks',
  },
});
const namespace = ns.metadata.name;

const labels = {
  'app.kubernetes.io/name': 'golinks',
};

const pvc = new k8s.core.v1.PersistentVolumeClaim('golinks', {
  metadata: {
    namespace,
  },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: {
      requests: {
        storage: '2Gi',
      },
    },
  },
});

const authkey = tailscaleKey('golinks', {
  tags: ['tag:tools', 'tag:tools-golinks'],
  expirySecs: 60 * 60, // 1 hour to set up service
});

const secret = new k8s.core.v1.Secret('authkey', {
  metadata: { namespace },
  stringData: {
    authkey: authkey.key,
  },
});

new k8s.apps.v1.Deployment('golinks', {
  metadata: {
    namespace,
  },
  spec: {
    replicas: 1,
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
                  matchExpressions: [purposeAffinity('workload'), archAffinity('arm64')],
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
        securityContext: {
          runAsNonRoot: true,
          fsGroup: 65532,
          // https://github.com/tailscale/golink#running-in-production
        },
        containers: [
          {
            name: 'server',
            image: 'ghcr.io/tailscale/golink:main',
            imagePullPolicy: 'Always',
            env: [
              {
                name: 'TS_AUTHKEY',
                valueFrom: {
                  secretKeyRef: {
                    name: secret.metadata.name,
                    key: 'authkey',
                  },
                },
              }
            ],
            resources: {
              requests: {
                cpu: '1m',
                memory: '100Mi',
              },
            },
            volumeMounts: [
              {
                name: 'state',
                mountPath: '/home/nonroot',
              },
            ],
          },
        ],
      },
    },
  },
});

import * as k8s from '@pulumi/kubernetes';
import { system } from './namespace.ts';
import { archAffinity, purposeAffinity } from '../../../common/k8s/affinities.ts';
import { appLabels, appSelector } from './labels.ts';

export const REDIS_PORT = 6379;

export const redis = new k8s.core.v1.Service(
  'redis',
  {
    metadata: {
      namespace: system,
      name: 'redis',
    },
    spec: {
      ports: [
        {
          protocol: 'TCP',
          port: REDIS_PORT,
          targetPort: 'redis',
          name: 'redis',
        },
      ],
      selector: appSelector('redis'),
    },
  },
  { replaceOnChanges: ['clusterIP'] },
);

const pvc = new k8s.core.v1.PersistentVolumeClaim(
  'redis',
  {
    metadata: {
      namespace: system,
    },
    spec: {
      accessModes: ['ReadWriteOnce'],
      storageClassName: 'ebs-gp3',
      resources: {
        requests: {
          storage: '1Gi',
        },
      },
    },
  },
  { parent: redis },
);

new k8s.apps.v1.Deployment(
  'redis',
  {
    metadata: {
      namespace: system,
      annotations: {
        'pulumi.com/patchForce': 'true',
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: appSelector('redis'),
      },
      template: {
        metadata: {
          labels: appLabels('redis'),
        },
        spec: {
          affinity: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  {
                    matchExpressions: [archAffinity('arm64'), purposeAffinity('workload')],
                  },
                ],
              },
            },
          },
          volumes: [
            {
              name: 'data',
              persistentVolumeClaim: {
                claimName: pvc.metadata.name,
              },
            },
          ],
          containers: [
            {
              name: 'server',
              image: 'redis:8.0.3',
              imagePullPolicy: 'IfNotPresent',
              command: ['redis-server'],
              args: ['--save', '60', '1', '--loglevel', 'warning'],
              volumeMounts: [
                {
                  name: 'data',
                  mountPath: '/data',
                },
              ],
              resources: {
                requests: {
                  cpu: '10m',
                  memory: '50Mi',
                },
              },
              ports: [
                {
                  name: 'redis',
                  containerPort: REDIS_PORT,
                  protocol: 'TCP',
                },
              ],
              startupProbe: {
                tcpSocket: {
                  port: 'redis',
                },
              },
              livenessProbe: {
                tcpSocket: {
                  port: 'redis',
                },
              },
            },
          ],
        },
      },
    },
  },
  { parent: redis },
);

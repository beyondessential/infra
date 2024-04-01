import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.js';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT, purposeAffinity } from '../common/k8s/affinities.js';
import { metricsScrape } from '../common/k8s/annotations.js';
import { cfg } from '../common/k8s/coreRef.js';

if (cfg.getSecret('mailgunApiKey')) {
  const VERSION = '0.0.7';
  const labels = {
    'app.kubernetes.io/name': 'mailgun-exporter',
    'app.kubernetes.io/version': VERSION,
  };

  const secret = new k8s.core.v1.Secret('mailgun-api-key', {
    metadata: {
      namespace,
      name: 'mailgun-api-key',
    },
    stringData: {
      region: cfg.get('mailgunRegion') ?? 'US',
      apiKey: cfg.requireSecret('mailgunApiKey'),
    },
  });

  new k8s.apps.v1.Deployment('mailgun-exporter', {
    metadata: {
      namespace,
      annotations: metricsScrape(9999),
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
                    matchExpressions: [purposeAffinity('workload')],
                  },
                ],
              },
            },
          },
          containers: [
            {
              name: 'exporter',
              image: 'denbeke/mailgun-exporter',
              imagePullPolicy: 'IfNotPresent',
              env: [
                {
                  name: 'MAILGUN_REGION',
                  valueFrom: {
                    secretKeyRef: {
                      name: secret.metadata.name,
                      key: 'region',
                    },
                  },
                },
                {
                  name: 'MAILGUN_PRIVATE_API_KEY',
                  valueFrom: {
                    secretKeyRef: {
                      name: secret.metadata.name,
                      key: 'apiKey',
                    },
                  },
                },
              ],
              resources: {
                requests: {
                  cpu: '50m',
                  memory: '50Mi',
                },
                limits: {
                  cpu: '100m',
                  memory: '100Mi',
                },
              },
              ports: [
                {
                  containerPort: 9999,
                  name: 'metrics',
                },
              ],
              livenessProbe: {
                periodSeconds: 10,
                failureThreshold: 2,
                httpGet: {
                  path: '/metrics',
                  port: 9999,
                },
              },
            },
          ],
        },
      },
    },
  });
}

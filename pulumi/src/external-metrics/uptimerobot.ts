import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../common/k8s/affinities.ts';
import { metricsScrape } from '../common/k8s/annotations.ts';
import { cfg } from '../common/k8s/coreRef.ts';

if (cfg.getSecret('uptimerobotApiKey')) {
  const labels = {
    'app.kubernetes.io/name': 'uptimerobot-exporter',
  };

  const secret = new k8s.core.v1.Secret('uptimerobot-api-key', {
    metadata: {
      namespace,
      name: 'uptimerobot-api-key',
    },
    stringData: {
      apiKey: cfg.requireSecret('uptimerobotApiKey'),
    },
  });

  new k8s.apps.v1.Deployment('uptimerobot-exporter', {
    metadata: {
      namespace,
      annotations: metricsScrape(9705, '/', true),
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
                    matchExpressions: [purposeAffinity('workload'), archAffinity('amd64')],
                  },
                ],
              },
            },
          },
          containers: [
            {
              name: 'exporter',
              image: 'lekpamartin/uptimerobot_exporter',
              imagePullPolicy: 'IfNotPresent',
              env: [
                {
                  name: 'UPTIMEROBOT_API_KEY',
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
                  cpu: '1m',
                  memory: '20Mi',
                },
              },
              ports: [
                {
                  containerPort: 9705,
                  name: 'metrics',
                },
              ],
              livenessProbe: {
                periodSeconds: 600,
                failureThreshold: 2,
                httpGet: {
                  path: '/',
                  port: 9705,
                },
              },
            },
          ],
        },
      },
    },
  });
}

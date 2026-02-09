import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { namespace, ns } from './namespace.ts';

const cfg = new pulumi.Config('postgres-restore-operator');
const image = cfg.require('image');
const maxConcurrentRestores = cfg.getNumber('maxConcurrentRestores') ?? 2;

const labels = {
  'app.kubernetes.io/name': 'postgres-restore-operator',
  'app.kubernetes.io/component': 'controller',
};

new k8s.core.v1.Service(
  'postgres-restore-operator-metrics',
  {
    metadata: {
      annotations: {
        'prometheus.io/port': '8080',
        'prometheus.io/scheme': 'http',
        'prometheus.io/scrape': 'true',
      },
      labels,
      name: 'postgres-restore-operator-metrics',
      namespace,
    },
    spec: {
      ports: [
        {
          name: 'metrics',
          port: 8080,
          targetPort: 'metrics',
        },
      ],
      selector: labels,
    },
  },
  { parent: ns },
);

new k8s.apps.v1.Deployment(
  'postgres-restore-operator',
  {
    metadata: {
      labels,
      name: 'postgres-restore-operator',
      namespace,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: labels,
      },
      template: {
        metadata: {
          annotations: {
            'prometheus.io/scrape': 'true',
            'prometheus.io/port': '8080',
          },
          labels,
        },
        spec: {
          serviceAccountName: 'postgres-restore-operator',
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65534,
            runAsGroup: 65534,
            fsGroup: 65534,
          },
          containers: [
            {
              name: 'controller',
              image,
              args: [
                `--max-concurrent-restores=${maxConcurrentRestores}`,
                '--metrics-addr=0.0.0.0:8080',
              ],
              ports: [
                {
                  name: 'metrics',
                  containerPort: 8080,
                  protocol: 'TCP',
                },
              ],
              readinessProbe: {
                httpGet: {
                  path: '/healthz',
                  port: 'metrics',
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: {
                  path: '/healthz',
                  port: 'metrics',
                },
                initialDelaySeconds: 15,
                periodSeconds: 20,
              },
              resources: {
                requests: {
                  cpu: '50m',
                  memory: '64Mi',
                },
                limits: {
                  cpu: '500m',
                  memory: '256Mi',
                },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: {
                  drop: ['ALL'],
                },
              },
            },
          ],
        },
      },
    },
  },
  { parent: ns },
);

import * as k8s from '@pulumi/kubernetes';
import { namespace, ns } from './namespace.ts';
import { image, maxConcurrentRestores } from './config.ts';

const labels = {
  'app.kubernetes.io/name': 'postgres-restore-operator',
  'app.kubernetes.io/component': 'controller',
};

const configMap = new k8s.core.v1.ConfigMap(
  'postgres-restore-operator-config',
  {
    metadata: {
      name: 'postgres-restore-operator-config',
      namespace,
    },
    data: {
      maxConcurrentRestores: String(maxConcurrentRestores),
    },
  },
  { parent: ns },
);

new k8s.core.v1.Service(
  'postgres-restore-operator',
  {
    metadata: {
      annotations: {
        'prometheus.io/port': '8080',
        'prometheus.io/scheme': 'http',
        'prometheus.io/scrape': 'true',
      },
      labels,
      name: 'postgres-restore-operator',
      namespace,
    },
    spec: {
      ports: [
        {
          name: 'http',
          port: 8080,
          targetPort: 'http',
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
      annotations: {
        'pulumi.com/patchForce': 'true',
      },
    },
    spec: {
      replicas: 1,
      strategy: { type: 'Recreate' },
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
              env: [
                {
                  name: 'METRICS_ADDR',
                  value: '[::]:8080',
                },
                // {
                //   name: 'RUST_LOG',
                //   value: 'info,tower_http=debug',
                // },
                {
                  name: 'OPERATOR_NAMESPACE',
                  valueFrom: {
                    fieldRef: {
                      fieldPath: 'metadata.namespace',
                    },
                  },
                },
                {
                  name: 'OPERATOR_SERVICE_NAME',
                  value: 'postgres-restore-operator',
                },
              ],
              ports: [
                {
                  name: 'http',
                  containerPort: 8080,
                  protocol: 'TCP',
                },
              ],
              readinessProbe: {
                httpGet: {
                  path: '/readyz',
                  port: 'http',
                },
                initialDelaySeconds: 5,
                periodSeconds: 10,
              },
              livenessProbe: {
                httpGet: {
                  path: '/livez',
                  port: 'http',
                },
                initialDelaySeconds: 15,
                periodSeconds: 20,
              },
              resources: {
                requests: {
                  cpu: '50m',
                  memory: '128Mi',
                },
                limits: {
                  cpu: '500m',
                  memory: '1Gi',
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
  { parent: ns, dependsOn: [configMap] },
);

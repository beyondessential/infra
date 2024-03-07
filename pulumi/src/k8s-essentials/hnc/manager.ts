// Converted from HNC v1.1.0 default-cm.yaml
import * as k8s from '@pulumi/kubernetes';
import { controlPlaneLabels, namespace, ns } from './namespace.js';
import { servingCert } from './cert.js';
import { hncSpec } from './specs.js';

new k8s.core.v1.Service(
  'hnc-controller-manager-metrics-service',
  {
    metadata: {
      annotations: {
        'prometheus.io/port': '8080',
        'prometheus.io/scheme': 'http',
        'prometheus.io/scrape': 'true',
      },
      labels: controlPlaneLabels,
      name: 'hnc-controller-manager-metrics-service',
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
      selector: controlPlaneLabels,
    },
  },
  { parent: ns },
);

new k8s.apps.v1.Deployment(
  'hnc-controller-manager',
  {
    metadata: {
      labels: controlPlaneLabels,
      name: 'hnc-controller-manager',
      namespace,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: controlPlaneLabels,
      },
      template: {
        metadata: {
          annotations: {
            'prometheus.io/scrape': 'true',
          },
          labels: controlPlaneLabels,
        },
        spec: hncSpec(['--no-webhooks']),
      },
    },
  },
  { parent: ns, dependsOn: [servingCert] },
);

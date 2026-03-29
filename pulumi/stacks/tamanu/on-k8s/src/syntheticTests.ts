import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { imageTag } from './image.ts';
import { architecture, domains, facilityNames } from './config.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.ts';

const image = `ghcr.io/beyondessential/tamanu-synthetic-tests:${imageTag}`;

const targets = [
  `https://${domains.central}`,
  ...facilityNames.map((name) => `https://${domains[name]}`),
].join(',');

new k8s.apps.v1.Deployment('synthetic-tests', {
  metadata: {
    namespace,
    annotations: {
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        'app.kubernetes.io/name': 'synthetic-tests',
        'app.kubernetes.io/component': 'artillery',
      },
    },
    template: {
      metadata: {
        labels: {
          'app.kubernetes.io/name': 'synthetic-tests',
          'app.kubernetes.io/component': 'artillery',
          'app.kubernetes.io/version': imageTag,
        },
      },
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
                  matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
                },
              ],
            },
          },
        },
        initContainers: [
          {
            name: 'wait-for-central',
            image,
            command: [
              'sh',
              '-c',
              'until curl -sf http://central-api/ > /dev/null 2>&1; do echo "Waiting for central API..."; sleep 5; done',
            ],
            resources: {
              requests: { cpu: '5m', memory: '32Mi' },
              limits: { cpu: '50m', memory: '64Mi' },
            },
          },
        ],
        containers: [
          {
            name: 'artillery',
            image,
            env: [{ name: 'TARGETS', value: targets }],
            resources: {
              requests: { cpu: '50m', memory: '128Mi' },
              limits: { cpu: '500m', memory: '512Mi' },
            },
          },
        ],
      },
    },
  },
});

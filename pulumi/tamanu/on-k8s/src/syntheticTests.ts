import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { imageTag } from './image.ts';
import { architecture, domains, facilityNames } from './config.ts';
import { CAN_RUN_ON_SPOT } from '../../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../common/k8s/affinities.ts';

const image = `ghcr.io/beyondessential/tamanu-synthetic-tests:${imageTag}`;

const centralTarget = `https://${domains.central}`;
const facilityTargets = facilityNames.map((name) => `https://${domains[name]}`).join(',');

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
        containers: [
          {
            name: 'artillery',
            image,
            env: [
              { name: 'CENTRAL_TARGETS', value: centralTarget },
              { name: 'FACILITY_TARGETS', value: facilityTargets },
            ],
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

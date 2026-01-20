import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { $core, region } from '../../common/k8s/coreRef.ts';

const opencostRoleArn = $core.opencostRoleArn;
const spotBucket = $core.spotDataFeedBucketName;

new k8s.helm.v3.Release(
  'opencost',
  {
    name: 'opencost',
    chart: 'opencost',
    version: '2.5.3',
    repositoryOpts: {
      repo: 'https://opencost.github.io/opencost-helm-chart',
    },
    namespace,
    values: {
      serviceAccount: {
        create: true,
        annotations: {
          'eks.amazonaws.com/role-arn': opencostRoleArn,
        },
      },
      opencost: {
        prometheus: {
          internal: {
            enabled: true,
            serviceName: 'prometheus-server',
            namespaceName: namespace,
            port: 80,
          },
        },
        ui: {
          enabled: true,
        },
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
                  matchExpressions: [
                    { key: 'bes.node.purpose', operator: 'In', values: ['workload'] },
                  ],
                },
              ],
            },
          },
        },
        exporter: {
          extraEnv: {
            AWS_SPOT_DATA_BUCKET: spotBucket,
            AWS_SPOT_DATA_REGION: region,
            AWS_SPOT_DATA_PREFIX: 'spot-pricing',
          },
          resources: {
            requests: {
              cpu: '10m',
              memory: '55Mi',
            },
            limits: {
              memory: '256Mi',
            },
          },
        },
      },
    },
  },
  {
    deleteBeforeReplace: true,
  },
);

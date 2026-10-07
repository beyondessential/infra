import { interpolate, jsonStringify } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { RUN_ON_SPOT } from '../../common/k8s/affinities.ts';
import { $core, accountId, region } from '../../common/k8s/coreRef.ts';
import { OPENCOST_VERSION } from '../versions.ts';

const opencostRoleArn = $core.opencostRoleArn;
const spotBucket = $core.spotDataFeedBucketName;
const exportBucket = $core.opencostExportBucketName;

// OpenCost reads the spot data feed settings only from its pricing file, never
// from the environment. The file replaces the image's built-in defaults
// wholesale, so those defaults (from the matching OpenCost release's
// configs/aws.json) are carried alongside the feed settings. `projectID` is
// the account ID the feed's object keys start with.
const pricingConfig = new k8s.core.v1.ConfigMap('opencost-pricing', {
  metadata: { namespace },
  data: {
    'aws.json': jsonStringify({
      provider: 'aws',
      description: 'Defaults from OpenCost, plus the spot data feed.',
      CPU: '0.031611',
      spotCPU: '0.006655',
      RAM: '0.004237',
      GPU: '0.95',
      spotRAM: '0.000892',
      storage: '0.00005479452',
      zoneNetworkEgress: '0.01',
      regionNetworkEgress: '0.01',
      internetNetworkEgress: '0.143',
      natGatewayEgress: '0.045',
      natGatewayIngress: '0.045',
      awsSpotDataRegion: region,
      awsSpotDataBucket: spotBucket,
      awsSpotDataPrefix: 'spot-pricing',
      projectID: accountId,
    }),
  },
});

new k8s.helm.v3.Release(
  'opencost',
  {
    name: 'opencost',
    chart: 'opencost',
    version: OPENCOST_VERSION,
    repositoryOpts: {
      repo: 'https://opencost.github.io/opencost-helm-chart',
    },
    namespace,
    values: {
      extraVolumes: [{ name: 'pricing-config', configMap: { name: pricingConfig.metadata.name } }],
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
          extraVolumeMounts: [
            { name: 'pricing-config', mountPath: '/var/configs/aws.json', subPath: 'aws.json' },
          ],
          extraEnv: {
            EXPORT_CSV_FILE: interpolate`s3://${exportBucket}/allocation.csv`,
            EXPORT_CSV_LABELS_ALL: 'true',
            EXPORT_CSV_MAX_DAYS: '365',
          },
          resources: {
            requests: {
              cpu: '10m',
              memory: '200Mi',
            },
            limits: {
              memory: '1Gi',
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

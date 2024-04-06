import { getStack } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import * as yaml from 'yaml';
import { CAN_RUN_ON_SPOT } from '../common/k8s/tolerations.js';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../common/k8s/affinities.js';
import { failIfIncorrectCluster } from '../common/k8s/coreRef.js';
await failIfIncorrectCluster();

const ns = new k8s.core.v1.Namespace(`msupply-${getStack()}`, {
  metadata: {
    name: `msupply-${getStack()}`,
  },
});
const namespace = ns.metadata.name;

function labels(component: 'server' | 'database') {
  return {
    'app.kubernetes.io/name': 'open-msupply',
    'app.kubernetes.io/component': component,
  };
}

const db = new k8s.apiextensions.CustomResource('msupply-db', {
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Cluster',
  metadata: {
    name: 'msupply-db',
    namespace,
    labels: labels('database'),
  },
  spec: {
    instances: 2,
    primaryUpdateStrategy: 'unsupervised',
    storage: {
      size: '10Gi',
    },
    resources: {
      requests: {
        memory: '250m',
        cpu: '100m',
      },
    },
    affinity: {
      additionalPodAntiAffinity: {
        // spread out the database pods across AZs
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 20,
            podAffinityTerm: {
              topologyKey: 'topology.kubernetes.io/zone',
              labelSelector: {
                matchExpressions: [
                  {
                    key: 'namespace',
                    operator: 'In',
                    values: [namespace],
                  },
                  {
                    key: 'app.kubernetes.io/component',
                    operator: 'In',
                    values: ['database'],
                  },
                ],
              },
            },
          },
        ],
      },
      tolerations: [CAN_RUN_ON_SPOT],
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
              matchExpressions: [purposeAffinity('workload'), archAffinity('arm64')],
            },
          ],
        },
      },
    },
  },
});

const port = 8000;

const config = new k8s.core.v1.ConfigMap(
  'msupply-server',
  {
    metadata: {
      namespace,
      labels: labels('server'),
    },
    data: {
      'production.yaml': yaml.stringify({
        server: {
          port,
          cors_origins: ['*'],
        },
        database: {
          host: 'msupply-db',
          port: 5432,
          user: 'app',
          database_name: 'app',
          password: 'TODO',
        },
        logging: {
          mode: 'Console',
          level: 'Info',
        },
      }),
    },
  },
  { ignoreChanges: ['data', 'binaryData'] },
);

new k8s.apps.v1.Deployment('msupply-server', {
  metadata: {
    namespace,
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: labels('server'),
    },
    template: {
      metadata: {
        labels: labels('server'),
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
            name: 'server',
            image: `143295493206.dkr.ecr.ap-southeast-2.amazonaws.com/tamanu/msupply`,
            imagePullPolicy: 'IfNotPresent',
            resources: {
              requests: {
                cpu: '1m',
                memory: '100Mi',
              },
            },
            ports: [
              {
                containerPort: port,
                name: 'http',
              },
            ],
            livenessProbe: {
              periodSeconds: 10,
              failureThreshold: 2,
              httpGet: {
                path: '/',
                port,
              },
            },
          },
        ],
      },
    },
  },
});

import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.js';
import { architecture, dbExpose, dbStorage, domains, normalizedStack, replicas } from './config.js';
import { runPostgres } from '../../common/k8s/postgres.js';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.js';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.js';
import { PostgresUrlSecretKey } from '../../common/k8s/postgresUrl.js';

import { namespace } from './namespace.js';
import { image } from './image.js';
import './ca.js';
import { caRootCert } from './ca.js';
import { interpolate } from '@pulumi/pulumi';
await failIfIncorrectCluster();

export { domains };

const dbReady = runPostgres({
  namespace,
  name: 'meta',
  replicas: 2,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  backupSchedule: true,
});

if (dbExpose) {
  new k8s.core.v1.Service('meta-db-tailscale', {
    metadata: {
      namespace,
      annotations: {
        'tailscale.com/hostname': `${normalizedStack}-db`,
        'tailscale.com/tags': 'tag:k8s-proxy,tag:server,tag:server-tamanu,tag:server-tamanu-meta',
      },
    },
    spec: {
      type: 'LoadBalancer',
      loadBalancerClass: 'tailscale',
      selector: {
        'cnpg.io/cluster': 'meta-db',
        'cnpg.io/instanceRole': 'replica',
      },
      allocateLoadBalancerNodePorts: false,
      ports: [
        {
          protocol: 'TCP',
          port: 5432,
          targetPort: 5432,
          name: 'postgresql',
        },
      ],
    },
  });
}

const labels = (task: string) => ({
  app: 'meta',
  task,
});

const http = new k8s.core.v1.Service(
  'http',
  {
    metadata: {
      namespace,
    },
    spec: {
      ports: [
        {
          protocol: 'TCP',
          port: 80,
          targetPort: 'http',
          name: 'http',
        },
      ],
      selector: labels('server'),
    },
  },
  { replaceOnChanges: ['clusterIP'] },
);

new k8s.networking.v1.Ingress('http', {
  metadata: {
    namespace,
    name: 'meta',
    annotations: {
      'cert-manager.io/cluster-issuer': 'letsencrypt',
      'cert-manager.io/private-key-algorithm': 'ECDSA',
      'nginx.ingress.kubernetes.io/auth-tls-secret': interpolate`${caRootCert.metadata.namespace}/${caRootCert.metadata.name}`,
      'nginx.ingress.kubernetes.io/auth-tls-verify-client': 'optional_no_ca',
      'nginx.ingress.kubernetes.io/auth-tls-pass-certificate-to-upstream': 'true',
    },
  },
  spec: {
    ingressClassName: 'nginx',
    tls: [{ hosts: domains, secretName: 'http-tls' }],
    rules: domains.map((host) => ({
      host,
      http: {
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: {
              service: {
                name: http.metadata.name,
                port: {
                  name: 'http',
                },
              },
            },
          },
        ],
      },
    })),
  },
});

function spec(
  name: string,
  command: string[] = [],
  containerArgs: Partial<k8s.types.input.core.v1.Container> = {},
): k8s.types.input.core.v1.PodSpec {
  return {
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
              matchExpressions: [archAffinity(architecture), purposeAffinity('workload')],
            },
          ],
        },
      },
    },
    containers: [
      {
        image: image(),
        imagePullPolicy: 'IfNotPresent',
        name,
        args: command,
        ports: [
          {
            containerPort: 8000,
            name: 'http',
          },
        ],
        env: [
          {
            name: 'ROCKET_PORT',
            value: '8000',
          },
          {
            name: 'ROCKET_LOG_LEVEL',
            value: 'normal',
          },
          {
            name: 'ROCKET_DATABASES',
            valueFrom: {
              secretKeyRef: dbReady.apply((url) => ({
                name: url.metadata.name,
                key: PostgresUrlSecretKey.AppRocket,
              })),
            },
          },
        ],
        resources: {
          requests: {
            cpu: '2m',
            memory: '10Mi',
          },
        },
        ...containerArgs,
      },
    ],
  };
}

const migrator = new k8s.batch.v1.Job('migrator', {
  metadata: {
    namespace,
  },
  spec: {
    backoffLimit: 5,
    template: {
      spec: {
        ...spec('migrate', ['migrate', 'run']),
        restartPolicy: 'Never',
      },
    },
  },
});

new k8s.apps.v1.Deployment(
  'server',
  {
    metadata: {
      labels: labels('server'),
      namespace,
    },
    spec: {
      replicas,
      selector: {
        matchLabels: labels('server'),
      },
      template: {
        metadata: {
          labels: labels('server'),
        },
        spec: spec('server', ['server', '--api-only'], {
          // Wait up to 60 seconds for the server to start...
          startupProbe: {
            periodSeconds: 1,
            failureThreshold: 60,
            httpGet: {
              path: '/servers',
              port: 8000,
              scheme: 'HTTP',
            },
          },
          // ...then continuously check if it's up, and restart if it fails
          livenessProbe: {
            periodSeconds: 10,
            failureThreshold: 2,
            httpGet: {
              path: '/servers',
              port: 8000,
              scheme: 'HTTP',
            },
          },
        }),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.apps.v1.Deployment(
  'pingtask',
  {
    metadata: {
      labels: labels('pingtask'),
      namespace,
    },
    spec: {
      replicas: 1,
      strategy: {
        type: 'Recreate',
      },
      selector: {
        matchLabels: labels('pingtask'),
      },
      template: {
        metadata: {
          labels: labels('pingtask'),
        },
        spec: spec('pingtask', ['pingtask']),
      },
    },
  },
  { dependsOn: [migrator] },
);

new k8s.batch.v1.CronJob(
  'prune',
  {
    metadata: {
      labels: labels('prune'),
      namespace,
    },
    spec: {
      schedule: '@daily',
      jobTemplate: {
        metadata: {
          labels: labels('prune'),
        },
        spec: {
          backoffLimit: 5,
          template: {
            spec: {
              ...spec('prune', ['prune_untrusted_devices']),
              restartPolicy: 'Never',
            },
          },
        },
      },
    },
  },
  { dependsOn: [migrator] },
);

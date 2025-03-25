import * as k8s from '@pulumi/kubernetes';
import { failIfIncorrectCluster, clusterName } from '../../common/k8s/coreRef.js';
import { namespace } from './namespace.js';
import { architecture, dbExpose, dbStorage, domains, normalizedStack, replicas } from './config.js';
import { caRootCert } from './ca.js';
import { runPostgres } from '../../common/k8s/postgres.js';
import { image } from './image.js';
import { archAffinity, purposeAffinity, RUN_ON_SPOT } from '../../common/k8s/affinities.js';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.js';
import { PostgresUrlSecretKey } from '../../common/k8s/postgresUrl.js';
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

new k8s.core.v1.Service('meta', {
  metadata: {
    annotations: {
      'external-dns.alpha.kubernetes.io/hostname': domains.join(','),
      'service.beta.kubernetes.io/aws-load-balancer-type': 'external',
      'service.beta.kubernetes.io/aws-load-balancer-nlb-target-type': 'ip',
      'service.beta.kubernetes.io/aws-load-balancer-ip-address-type': 'dualstack',
      'service.beta.kubernetes.io/aws-load-balancer-scheme': 'internet-facing',
      'service.beta.kubernetes.io/aws-load-balancer-target-group-attributes':
        'preserve_client_ip.enabled=true',
      'service.beta.kubernetes.io/aws-load-balancer-additional-resource-tags': clusterName.apply(
        (clusterName) =>
          Object.entries({
            Cluster: `k8s-${clusterName}`,
            EKSCluster: clusterName,
            Purpose: 'k8s-ingress',
            'k8s:cluster-name': clusterName,
          })
            .map(([k, v]) => `${k}=${v}`)
            .join(','),
      ),
    },
    namespace,
  },
  spec: {
    type: 'LoadBalancer',
    ipFamilyPolicy: 'SingleStack',
    ipFamilies: ['IPv6'],
    ports: [
      {
        protocol: 'TCP',
        port: 443,
        targetPort: 'https',
        name: 'https',
      },
    ],
    selector: labels('server'),
  },
});

const appConfig = new k8s.core.v1.ConfigMap('rocket', {
  metadata: {
    namespace,
  },
  data: {
    'Rocket.toml': `
[default.tls]
certs = "https/tls.crt"
key = "https/tls.key"

[default.tls.mutual]
ca_certs = "mtls/ca.crt"`,
  },
});

const tlsSecret = 'app-tls';
new k8s.apiextensions.CustomResource('app-tls', {
  apiVersion: 'cert-manager.io/v1',
  kind: 'Certificate',
  metadata: {
    namespace,
    annotations: {
      'pulumi.com/patchForce': 'true',
    },
  },
  spec: {
    commonName: domains[0],
    dnsNames: domains,
    secretName: tlsSecret,
    privateKey: {
      algorithm: 'ECDSA',
      size: 256,
    },
    issuerRef: {
      group: 'cert-manager.io',
      kind: 'ClusterIssuer',
      name: 'letsencrypt',
    },
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
    volumes: [
      {
        name: 'config-volume',
        configMap: {
          name: appConfig.metadata.name,
        },
      },
      {
        name: 'https-volume',
        secret: {
          secretName: tlsSecret,
          items: [
            {
              key: 'tls.key',
              path: 'tls.key',
            },
            {
              key: 'tls.crt',
              path: 'tls.crt',
            },
          ],
        },
      },
      {
        name: 'mtls-volume',
        secret: {
          secretName: caRootCert.metadata.name,
          items: [
            {
              key: 'tls.crt',
              path: 'ca.crt',
            },
          ],
        },
      },
    ],
    containers: [
      {
        image: image(),
        imagePullPolicy: 'IfNotPresent',
        name,
        args: command,
        volumeMounts: [
          {
            name: 'config-volume',
            mountPath: '/home/tamanu/config',
          },
          {
            name: 'https-volume',
            mountPath: '/home/tamanu/https',
          },
          {
            name: 'mtls-volume',
            mountPath: '/home/tamanu/mtls',
          },
        ],
        ports: [
          {
            containerPort: 8000,
            name: 'https',
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
          /*
          // Wait up to 60 seconds for the server to start...
          startupProbe: {
            periodSeconds: 1,
            failureThreshold: 60,
            httpGet: {
              path: '/',
              port: 8000,
              scheme: 'HTTPS',
            },
          },
          // ...then continuously check if it's up, and restart if it fails
          livenessProbe: {
            periodSeconds: 10,
            failureThreshold: 2,
            httpGet: {
              path: '/',
              port: 8000,
              scheme: 'HTTPS',
            },
          },
          */
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

import * as k8s from '@pulumi/kubernetes';
import { jsonStringify } from '@pulumi/pulumi';
import { TAILSCALE_VERSION } from '../../../k8s-essentials/versions.ts';
import { namespace, ns } from './namespace.ts';
import {
  image,
  maxConcurrentRestores,
  tailscaleAuthkey,
  canopyTailnetUrl,
  builderPullUser,
  builderPullPat,
} from './config.ts';

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
      // Scheduling defaults the operator stamps onto every pod it creates
      // (restore Jobs, replica Deployments). Without them those pods land on
      // whichever pool the autoscaler weights highest. Restored databases
      // belong on the dedicated replica pool (k8s-core karpenter/pools.ts),
      // and Karpenter only provisions there for pods tolerating both of its
      // taints. do-not-disrupt keeps Karpenter from consolidating a node out
      // from under a restore. The operator image must support `tolerations`:
      // one that ignores the key leaves its pods selecting a pool they can't
      // schedule onto.
      nodeSelector: 'bes.node.group=db-replica',
      podAnnotations: 'karpenter.sh/do-not-disrupt=true',
      tolerations: 'bes.node.group=db-replica:NoSchedule,spotInstance=true:PreferNoSchedule',
    },
  },
  { parent: ns },
);

const authkeySecret = new k8s.core.v1.Secret(
  'pgro-operator-tailscale-authkey',
  {
    metadata: {
      name: 'pgro-operator-tailscale-authkey',
      namespace,
    },
    stringData: {
      TS_AUTHKEY: tailscaleAuthkey,
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
        // Credential-broker port. Reached from canopy-backed Job pods' proxy
        // sidecars in-cluster only; gated by the NetworkPolicy below.
        {
          name: 'broker',
          port: 9091,
          targetPort: 'broker',
        },
      ],
      selector: labels,
    },
  },
  { parent: ns },
);

const controllerEnv: k8s.types.input.core.v1.EnvVar[] = [
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
  {
    name: 'CANOPY_TAILNET_URL',
    value: canopyTailnetUrl,
  },
  {
    name: 'CANOPY_PROXY_IMAGE',
    value: image,
  },
];

// pgro copies this into each build namespace it creates, so it lives here in
// the operator's namespace rather than in any replica's.
if (builderPullUser && builderPullPat) {
  new k8s.core.v1.Secret(
    'pgro-builder-pull',
    {
      metadata: {
        name: 'pgro-builder-pull',
        namespace,
      },
      type: 'kubernetes.io/dockerconfigjson',
      stringData: {
        '.dockerconfigjson': jsonStringify({
          auths: {
            'ghcr.io': {
              auth: builderPullPat.apply((pat) =>
                Buffer.from(`${builderPullUser}:${pat}`).toString('base64'),
              ),
            },
          },
        }),
      },
    },
    { parent: ns },
  );
  controllerEnv.push({ name: 'BUILDER_PULL_SECRET', value: 'pgro-builder-pull' });
}

const containers: k8s.types.input.core.v1.Container[] = [
  {
    name: 'controller',
    image,
    command: ['pgro'],
    env: controllerEnv,
    ports: [
      {
        name: 'http',
        containerPort: 8080,
        protocol: 'TCP',
      },
      {
        name: 'broker',
        containerPort: 9091,
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
    volumeMounts: [{ name: 'tailscale-socket', mountPath: '/var/run/tailscale', readOnly: true }],
  },
  // pgro reaches Canopy only through this sidecar's SOCKS5 proxy on [::1]:1055.
  // Tailnet state persists in the pgro-operator-tailscale-state Secret (scoped
  // Role in roles.ts).
  {
    name: 'tailscale',
    image: `ghcr.io/tailscale/tailscale:v${TAILSCALE_VERSION}`,
    env: [
      { name: 'TS_USERSPACE', value: 'true' },
      { name: 'TS_SOCKS5_SERVER', value: '[::]:1055' },
      { name: 'TS_HOSTNAME', value: 'pgro-operator' },
      { name: 'TS_KUBE_SECRET', value: 'pgro-operator-tailscale-state' },
      {
        name: 'TS_AUTHKEY',
        valueFrom: {
          secretKeyRef: {
            name: authkeySecret.metadata.name,
            key: 'TS_AUTHKEY',
          },
        },
      },
    ],
    securityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: false,
      capabilities: {
        drop: ['ALL'],
      },
    },
    resources: {
      requests: {
        cpu: '20m',
        memory: '64Mi',
      },
      limits: {
        cpu: '200m',
        memory: '256Mi',
      },
    },
    volumeMounts: [{ name: 'tailscale-socket', mountPath: '/var/run/tailscale' }],
  },
];

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
          containers,
          volumes: [{ name: 'tailscale-socket', emptyDir: {} }],
        },
      },
    },
  },
  { parent: ns, dependsOn: [configMap] },
);

// Gate the credential-broker port (9091) to canopy Job proxy sidecars, which
// the canopy Job builder labels pgro.bes.au/proxy-sidecar=true. Metrics (8080)
// stays open per the Prometheus scrape convention.
new k8s.networking.v1.NetworkPolicy(
  'postgres-restore-operator-broker',
  {
    metadata: {
      name: 'postgres-restore-operator-broker',
      namespace,
    },
    spec: {
      podSelector: {
        matchLabels: labels,
      },
      policyTypes: ['Ingress'],
      ingress: [
        {
          ports: [{ port: 8080, protocol: 'TCP' }],
        },
        {
          from: [
            {
              namespaceSelector: {},
              podSelector: {
                matchLabels: {
                  'pgro.bes.au/proxy-sidecar': 'true',
                },
              },
            },
          ],
          ports: [{ port: 9091, protocol: 'TCP' }],
        },
      ],
    },
  },
  { parent: ns },
);

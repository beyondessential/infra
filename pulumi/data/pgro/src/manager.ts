import * as k8s from '@pulumi/kubernetes';
import { TAILSCALE_VERSION } from '../../../k8s-essentials/versions.ts';
import { namespace, ns } from './namespace.ts';
import {
  image,
  maxConcurrentRestores,
  tailscaleAuthkey,
  canopyBaseUrl,
  canopyDeviceKey,
  canopyPgdataPvcSize,
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

// Tailscale sidecar authkey (tag:pgro-operator). Presence enables the sidecar
// and, with it, the canopy path over the tailnet.
const authkeySecret = tailscaleAuthkey
  ? new k8s.core.v1.Secret(
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
    )
  : undefined;

// The operator's own device private key (P-256 EC, PEM). bestool-canopy
// self-signs a short-lived cert from it; its public key is the canopy device
// identity, promoted to backup-restore canopy-side. pgro reads the first
// entry of this Secret and uses it as its mTLS identity when the tailnet
// probe fails.
if (canopyDeviceKey) {
  new k8s.core.v1.Secret(
    'pgro-canopy-device-key',
    {
      metadata: {
        name: 'pgro-canopy-device-key',
        namespace,
      },
      stringData: {
        'device.pem': canopyDeviceKey,
      },
    },
    { parent: ns },
  );
}

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
];

// Canopy integration. CANOPY_BASE_URL opts the operator into the canopy path;
// the client prefers the tailnet SOCKS5 proxy the sidecar exposes on
// [::1]:1055 (its default) and falls back to mTLS against this URL. It needs
// at least one working transport — the tailnet sidecar (authkey) or the mTLS
// device key — or bestool-canopy errors on construction. So require the base
// URL plus either transport.
const canopyActive = !!(canopyBaseUrl && (authkeySecret || canopyDeviceKey));
if (canopyActive) {
  controllerEnv.push({ name: 'CANOPY_BASE_URL', value: canopyBaseUrl! });
  if (canopyDeviceKey) {
    controllerEnv.push({ name: 'CANOPY_DEVICE_CERT_SECRET', value: 'pgro-canopy-device-key' });
  }
  if (canopyPgdataPvcSize) {
    controllerEnv.push({ name: 'CANOPY_PGDATA_PVC_SIZE', value: canopyPgdataPvcSize });
  }
}

const containers: k8s.types.input.core.v1.Container[] = [
  {
    name: 'controller',
    image,
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
  },
];

// Tailscale sidecar — the primary production network path to canopy.
// bestool-canopy's CanopyClient auto-probes canopy.tail53aef.ts.net through
// the SOCKS5 proxy this exposes on [::1]:1055. Tailnet state persists in the
// pgro-operator-tailscale-state Secret (scoped Role in roles.ts).
if (authkeySecret) {
  containers.push({
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
  });
}

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

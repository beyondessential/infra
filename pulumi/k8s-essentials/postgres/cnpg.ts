import * as k8s from '@pulumi/kubernetes';
import { BARMAN_CLOUD_PLUGIN_VERSION, CNPG_VERSION } from '../versions.ts';

const namespace = new k8s.core.v1.Namespace('cnpg-system', {
  metadata: {
    name: 'cnpg-system',
  },
});

const cnpg = new k8s.helm.v3.Chart('cloudnative-pg', {
  repo: 'cnpg',
  chart: 'cloudnative-pg',
  version: CNPG_VERSION,
  fetchOpts: {
    repo: 'https://cloudnative-pg.github.io/charts',
  },
  namespace: namespace.metadata.name,
  values: {
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [{ key: 'bes.node.purpose', operator: 'In', values: ['system'] }],
            },
          ],
        },
      },
    },
  },
});

new k8s.core.v1.ConfigMap(
  'cnpg-controller-config',
  {
    metadata: {
      name: 'cnpg-controller-manager-config',
      namespace: namespace.metadata.name,
    },
    data: {
      INHERITED_LABELS: 'app.kubernetes.io/*',
    },
  },
  { dependsOn: [cnpg] },
);

new k8s.yaml.v2.ConfigFile('catalog-postgres', {
  file: 'https://raw.githubusercontent.com/cloudnative-pg/postgres-containers/main/Debian/ClusterImageCatalog-bookworm.yaml',
});
new k8s.yaml.v2.ConfigFile('catalog-postgis', {
  file: 'https://raw.githubusercontent.com/cloudnative-pg/postgis-containers/main/image-catalogs/postgis-system-bookworm.yaml',
});

new k8s.helm.v3.Chart('barman-cloud-plugin', {
  repo: 'cnpg',
  chart: 'plugin-barman-cloud',
  version: BARMAN_CLOUD_PLUGIN_VERSION,
  fetchOpts: {
    repo: 'https://cloudnative-pg.github.io/charts',
  },
  namespace: namespace.metadata.name,
  // The `barman-cloud` Service and the plugin's Certificates were once applied
  // by hand — a kustomize install of the same plugin that predated this chart —
  // so another field manager owns fields this chart also sets, and server-side
  // apply will not take them over unless forced.
  //
  // Force it, but only because that install is gone. While both existed, forcing
  // handed the Service's .spec.selector to this chart and pointed it at a pod
  // that could never be ready: two copies of the plugin both ran with
  // --leader-elect, the hand-applied one held the lease, and this chart's pod
  // sat as a standby that never opened :9090. Removing the duplicate is what
  // fixed it. If these conflicts ever come back, look for a second install
  // before reaching for this annotation again.
  transformations: [
    (obj: { metadata?: { annotations?: { [key: string]: string } } }) => {
      obj.metadata ??= {};
      obj.metadata.annotations = {
        ...obj.metadata.annotations,
        'pulumi.com/patchForce': 'true',
      };
    },
  ],
  values: {
    affinity: {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [{ key: 'bes.node.purpose', operator: 'In', values: ['system'] }],
            },
          ],
        },
      },
    },
  },
});

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
  // NOTE: do not add pulumi.com/patchForce here to silence the server-side apply
  // conflicts this chart reports. The conflicts are a symptom: the plugin is
  // installed twice in cnpg-system. A hand-applied copy from 2026-05-19 runs as
  // the `barman-cloud` Deployment and is the one CNPG actually talks to, while
  // this chart's `barman-cloud-plugin-plugin-barman-cloud` Deployment has never
  // passed its readiness probe since it appeared on 2026-06-19.
  //
  // Forcing the conflict hands the `barman-cloud` Service's .spec.selector to
  // this chart, which repoints it from the working Deployment at the broken one
  // and leaves the Service with no ready endpoints — taking barman backups down
  // cluster-wide. Leave the conflicts erroring until the duplicate install is
  // resolved: a noisy up is better than a silent outage.
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

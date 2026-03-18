import * as k8s from '@pulumi/kubernetes';
import { CNPG_VERSION } from '../versions.ts';

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

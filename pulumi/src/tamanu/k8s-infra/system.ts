import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import * as k8s from '@pulumi/kubernetes';

function readConfig(
  template: string,
  file: string,
  { outname, encoding = 'utf-8' }: { outname?: string; encoding?: BufferEncoding } = {},
) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'templates', template);
  const filename = join(dir, existsSync(join(dir, file)) ? file : `${file}.njk`);
  if (!existsSync(filename)) {
    throw new Error(`Template ${template}/${file} not found`);
  }

  return {
    [outname ? `${outname}.${extname(filename)}` : basename(filename)]: readFileSync(
      filename,
      encoding,
    ),
  };
}

const namespace = new k8s.core.v1.Namespace('tamanu-system', {
  metadata: {
    name: 'tamanu-system',
  },
});

for (const template of ['basic', 'pr', 'rc']) {
  new k8s.core.v1.ConfigMap(
    `provisioning-${template}`,
    {
      metadata: {
        name: `provisioning-template-${template}`,
        namespace: namespace.metadata.name,
        labels: {
          'bes.tamanu/template': 'provisioning',
        },
      },
      data: readConfig(template, 'provisioning.json5'),
    },
    { ignoreChanges: ['data', 'binaryData', 'stringData'] },
  );

  new k8s.core.v1.ConfigMap(
    `config-central-${template}`,
    {
      metadata: {
        name: `config-central-template-${template}`,
        namespace: namespace.metadata.name,
        labels: {
          'bes.tamanu/template': 'config-central',
        },
      },
      data: readConfig(template, 'central.json5', { outname: 'production' }),
    },
    { ignoreChanges: ['data', 'binaryData', 'stringData'] },
  );

  new k8s.core.v1.ConfigMap(
    `config-facility-${template}`,
    {
      metadata: {
        name: `config-facility-template-${template}`,
        namespace: namespace.metadata.name,
        labels: {
          'bes.tamanu/template': 'config-facility',
        },
      },
      data: readConfig(template, 'facility.json5', { outname: 'production' }),
    },
    { ignoreChanges: ['data', 'binaryData', 'stringData'] },
  );
}

new k8s.rbac.v1.RoleBinding('edit', {
  metadata: {
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'edit',
  },
});

new k8s.rbac.v1.RoleBinding('read', {
  metadata: {
    namespace: namespace.metadata.name,
  },
  roleRef: {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'read',
  },
});

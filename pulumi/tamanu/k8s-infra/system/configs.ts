import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';

function readConfig(
  template: string,
  file: string,
  { outname, encoding = 'utf-8' }: { outname?: string; encoding?: BufferEncoding } = {},
) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', template);
  const isTemplate = !existsSync(join(dir, file));
  const filename = join(dir, isTemplate ? `${file}.njk` : file);
  if (!existsSync(filename)) {
    throw new Error(`Template ${template}/${file} not found`);
  }

  // extname() only returns the last extension (e.g. '.njk' from 'local.json5.njk').
  // Preserve the full extension so the rendered key is 'local.json5.njk', not 'local..njk'.
  const fullExt = isTemplate ? `${extname(file)}.njk` : extname(file);
  return {
    [outname ? `${outname}${fullExt}` : basename(filename)]: readFileSync(filename, encoding),
  };
}

for (const template of ['basic', 'pr', 'rc', 'demo']) {
  new k8s.core.v1.ConfigMap(
    `provisioning-${template}`,
    {
      metadata: {
        name: `provisioning-template-${template}`,
        namespace,
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
        namespace,
        labels: {
          'bes.tamanu/template': 'config-central',
        },
      },
      data: readConfig(template, 'central.json5', { outname: 'local' }),
    },
    { ignoreChanges: ['data', 'binaryData', 'stringData'] },
  );

  new k8s.core.v1.ConfigMap(
    `config-facility-${template}`,
    {
      metadata: {
        name: `config-facility-template-${template}`,
        namespace,
        labels: {
          'bes.tamanu/template': 'config-facility',
        },
      },
      data: readConfig(template, 'facility.json5', { outname: 'local' }),
    },
    { ignoreChanges: ['data', 'binaryData', 'stringData'] },
  );
}

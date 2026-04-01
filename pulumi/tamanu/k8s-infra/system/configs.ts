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

for (const template of ['basic', 'pr', 'rc']) {
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

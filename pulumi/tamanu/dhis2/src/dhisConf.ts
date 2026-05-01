import * as k8s from '@pulumi/kubernetes';

import { namespace } from './namespace.ts';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

function readFile(
  file: string,
  { encoding = 'utf-8' }: { outname?: string; encoding?: BufferEncoding } = {},
) {
  const filePath = join(dirname(fileURLToPath(import.meta.url)), '..', file);
  if (!existsSync(filePath)) {
    throw new Error(`File ${file} not found`);
  }

  return readFileSync(filePath, encoding);
}

export const dhisConf = new k8s.core.v1.ConfigMap(`config-dhis2`, {
  metadata: {
    namespace,
  },
  data: {
    'dhis.conf': readFile('dhis.conf'),
    'startup.sh': `
cp /config/dhis.conf /opt/dhis2/dhis.conf
catalina.sh run
`,
  },
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as k8s from '@pulumi/kubernetes';

export const ns = new k8s.core.v1.Namespace('rust-build', {
  metadata: { name: 'rust-build' },
});
export const namespace = ns.metadata.name;

// setup.sh is a real file (lint/edit/execute it directly), read in and shipped
// as a ConfigMap rather than an inline string. Mirrors how instanceTypeGroups.ts
// reads instances.json.
const setupScript = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'setup.sh'),
  'utf-8',
);

export const setupConfigMap = new k8s.core.v1.ConfigMap('rust-build-setup', {
  metadata: { namespace },
  data: { 'setup.sh': setupScript },
});

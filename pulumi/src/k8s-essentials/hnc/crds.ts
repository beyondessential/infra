import * as k8s from '@pulumi/kubernetes';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

new k8s.yaml.ConfigFile('hnc-crds', {
  file: join(dirname(fileURLToPath(import.meta.url)), 'crds.yaml'),
});

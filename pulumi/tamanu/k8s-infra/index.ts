import { Config } from '@pulumi/pulumi';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './system.ts';
import './superns.ts';
import './roles/index.ts';
import './seed/index.ts';

// Argo CD applies the deployments tamanu-on-k8s hands over to it. Omit the key
// to skip it.
if (new Config('argo').get('renderImageTag')) {
  await import('./argo/index.ts');
}

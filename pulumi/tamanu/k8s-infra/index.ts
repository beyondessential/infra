import { Config } from '@pulumi/pulumi';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './system.ts';
import './superns.ts';
import './roles/index.ts';
import './seed/index.ts';

// The Tamanu side of Argo CD, which k8s-essentials installs. Set `argo:enabled`
// once it is there.
if (new Config('argo').getBoolean('enabled')) {
  await import('./argo/index.ts');
}

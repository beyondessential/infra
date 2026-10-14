import { cfg } from '../../common/cfg.ts';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './system.ts';
import './superns.ts';
import './roles/index.ts';
import './seed/index.ts';

// The Tamanu side of Argo CD, which k8s-essentials installs. Set `argoEnabled`
// once it is there.
if (cfg.getBoolean('argoEnabled') ?? false) {
  await import('./argo/index.ts');
}

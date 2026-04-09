import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './system.ts';
import './superns.ts';
import './roles/index.ts';
import './pgsnap.ts';

import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

// The CRDs must be applied separately, Pulumi barfs on them.

import './namespace.ts';
import './roles.ts';
import './manager.ts';

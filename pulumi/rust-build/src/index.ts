import { failIfIncorrectAccount } from '../../common/coreRef.ts';
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';

// This stack creates AWS resources, so guard the creds point at the right
// account. Needs a `core` config key (the core stack ref), like k8s-core.
failIfIncorrectAccount();
await failIfIncorrectCluster();

// Cluster capacity (own NodeClass + build NodePools).
import './nodeClass.ts';
import './pools.ts';

// Namespace + user RBAC + artifact bucket/IRSA + SA + slot leases + builders.
import './namespace.ts';
import './rbac.ts';
import './artifacts.ts';
import './serviceAccount.ts';
import './leases.ts';
import './builders.ts';

export { namespace } from './namespace.ts';

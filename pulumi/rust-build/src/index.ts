import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

// Cluster capacity (own NodeClass + build NodePools).
import './nodeClass.ts';
import './pools.ts';

// Namespace + user RBAC + slot leases + the per-arch warm builders.
import './namespace.ts';
import './rbac.ts';
import './leases.ts';
import './builders.ts';

export { namespace } from './namespace.ts';

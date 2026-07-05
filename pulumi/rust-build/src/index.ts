import { failIfIncorrectAccount, failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
import { accountId } from '../../common/awsAccount.ts';

// This stack creates AWS resources, so guard the creds point at the cluster's
// account. Reuses the core stack reference the k8s coreRef already derives — no
// extra config key, no duplicate StackReference.
failIfIncorrectAccount(accountId);
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

import { failIfIncorrectCluster } from '../../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

// No `failIfIncorrectAccountOrRegion()` here: this stack's only cross-stack
// read (the IRSA role ARN, via serviceAccount.ts) goes through Pulumi's own
// state backend, not an AWS API call, so no AWS credentials are needed to
// apply it — see K8SNSP#cluster-endpoint-access and dagster-infra's header
// comment for the stack that does need them.

import './namespace.ts';
import './serviceAccount.ts';
import './secrets.ts';
import './helm.ts';
import './ingress.ts';
import './rbac.ts';

export { namespace } from './namespace.ts';

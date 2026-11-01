import * as k8s from '@pulumi/kubernetes';
import { CrossStack } from '../../../common/CrossStack.ts';
import { namespace } from './namespace.ts';
import { irsaStack } from './config.ts';

// Same service account name the dagster-irsa project's trust policy names
// (its default 'dagster', overridable there via serviceAccountName config —
// keep the two in sync by hand if either changes).
export const serviceAccountName = 'dagster';

const roleArn = new CrossStack(irsaStack).get<string>('dagsterComputeLogsRoleArn');

new k8s.core.v1.ServiceAccount('dagster', {
	metadata: {
		name: serviceAccountName,
		namespace,
		annotations: { 'eks.amazonaws.com/role-arn': roleArn },
	},
});

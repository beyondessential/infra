import * as k8s from '@pulumi/kubernetes';
import { CrossStack } from '../../../common/CrossStack.ts';
import { namespace } from './namespace.ts';
import { infraStack } from './config.ts';

// Same service account name the dagster-infra project's trust policy names
// (its default 'dagster', overridable there via serviceAccountName config —
// keep the two in sync by hand if either changes). One role for everything
// dagster-infra grants — compute-log S3 access, and (if dbIamAuth is on)
// RDS IAM auth — since it's the same pods (webserver, daemon) needing both.
export const serviceAccountName = 'dagster';

const roleArn = new CrossStack(infraStack).get<string>('dagsterRoleArn');

new k8s.core.v1.ServiceAccount('dagster', {
	metadata: {
		name: serviceAccountName,
		namespace,
		annotations: { 'eks.amazonaws.com/role-arn': roleArn },
	},
});

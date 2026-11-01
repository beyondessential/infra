import { jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';
import { failIfIncorrectAccountOrRegion, cfg } from '../../common/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { AWS_S3_WRITE_ACTIONS } from '../../constants/external.ts';

await failIfIncorrectAccountOrRegion();

// Deliberately a separate project from `data/dagster`, applied by a human with
// aws-sso rather than by the data-lake GHA workflow — see K8SNSP#cluster-endpoint-access:
// "A stack that manages only in-cluster resources MUST be applicable with a
// tailnet identity and no AWS credentials." Mixing this one AWS role into the
// in-cluster stack would force every routine `pulumi up` there to carry AWS
// creds too. Same split as canopy/canopy-infra.

const oidcProviderArn = new CrossStack(cfg.require('k8s-core')).k8sCoreOutput().oidcProviderArn;

// The dagster-dev and dagster-prod namespaces both need this role under the same
// service account name (S3ComputeLogManager has no per-namespace identity of its
// own); the trust policy's `namespace` wildcard covers both without a second role.
const namespacePattern = cfg.get('namespacePattern') ?? 'dagster-*';
const serviceAccountName = cfg.get('serviceAccountName') ?? 'dagster';

// Existing bucket (data/bucket stack creates and owns it); this role only ever
// reads and writes compute-log objects in it, never deletes or manages the
// bucket itself.
const bucket = cfg.require('computeLogsBucket');

const computeLogsPolicy = new awsNative.iam.ManagedPolicy(
	'dagster-compute-logs',
	{
		policyDocument: jsonStringify({
			Version: '2012-10-17',
			Statement: [
				{
					Effect: 'Allow',
					Action: AWS_S3_WRITE_ACTIONS,
					Resource: [
						`arn:aws:s3:::${bucket}`,
						`arn:aws:s3:::${bucket}/dagster-compute-logs/*`,
					],
				},
			],
		}),
	},
	{ ignoreChanges: ['users', 'roles', 'groups'] },
);

const computeLogsRole = eksServiceAccount('dagster-compute-logs', {
	serviceAccountName,
	oidcProviderArn,
	namespace: namespacePattern,
	managedPolicyArns: [computeLogsPolicy.policyArn],
});

export const dagsterComputeLogsRoleArn = computeLogsRole.arn;

import { jsonStringify, type Output } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { failIfIncorrectAccountOrRegion, cfg } from '../../common/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { accountId, region } from '../../common/awsAccount.ts';
import { AWS_S3_WRITE_ACTIONS } from '../../constants/external.ts';

await failIfIncorrectAccountOrRegion();

// Deliberately a separate project from `data/dagster`, applied by a human with
// aws-sso rather than by the data-lake GHA workflow — see K8SNSP#cluster-endpoint-access:
// "A stack that manages only in-cluster resources MUST be applicable with a
// tailnet identity and no AWS credentials." Mixing AWS resources into the
// in-cluster stack would force every routine `pulumi up` there to carry AWS
// creds too. Same split as canopy/canopy-infra. No longer IRSA-only (hence
// the project name, not "dagster-irsa"): it now also grants RDS IAM auth, and
// may grow further as this moves off EC2.

const oidcProviderArn = new CrossStack(cfg.require('k8s-core')).k8sCoreOutput().oidcProviderArn;

// The dagster-dev and dagster-prod namespaces both need this role under the
// same service account name; the trust policy's `namespace` wildcard covers
// both without a second role.
const namespacePattern = cfg.get('namespacePattern') ?? 'dagster-*';
const serviceAccountName = cfg.get('serviceAccountName') ?? 'dagster';

const managedPolicyArns: Output<string>[] = [];

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
managedPolicyArns.push(computeLogsPolicy.policyArn);

// RDS IAM auth: Dagster's own storage connection (its
// run/event-log Postgres, on the existing data-warehouse RDS) can authenticate
// with a short-lived token from this role instead of a stored password — the
// chart supports this natively (postgresql.authProvider.type: aws_wif in
// data/dagster's helm.ts). Off by default (dbIamAuth), since two things need
// confirming before it actually works, neither of which Pulumi manages:
//   1. IAM database authentication must be enabled on the RDS instance itself
//      (the `iam_db_auth_enabled` parameter) — unconfirmed whether it already
//      is on the shared data-warehouse RDS.
//   2. The Postgres role Dagster connects as needs `GRANT rds_iam TO
//      <dbUser>;` run once by a DB admin — a SQL statement, not an AWS or k8s
//      resource, so nothing here can do it.
// No existing precedent for this pattern anywhere else in this repo; this is
// genuinely new, not a known-working house convention yet.
const dbIamAuth = cfg.getBoolean('dbIamAuth') ?? false;
if (dbIamAuth) {
	// The human-readable DB instance identifier (RDS console name), not the
	// opaque DbiResourceId the IAM policy actually needs — looked up below so
	// config only ever needs the name a person would actually recognise.
	const dbInstanceIdentifier = cfg.require('dbInstanceIdentifier');
	// Must match data/dagster's own `dbUser` config exactly — the two are
	// separate Pulumi projects with no shared config, so keep them in sync by
	// hand, the same as `computeLogsBucket` above.
	const dbUser = cfg.require('dbUser');

	const dbInstance = awsClassic.rds.getInstanceOutput({ dbInstanceIdentifier });

	const rdsConnectPolicy = new awsNative.iam.ManagedPolicy(
		'dagster-rds-iam-auth',
		{
			policyDocument: jsonStringify({
				Version: '2012-10-17',
				Statement: [
					{
						Effect: 'Allow',
						Action: 'rds-db:connect',
						Resource: dbInstance.resourceId.apply(
							(resourceId) =>
								`arn:aws:rds-db:${region}:${accountId}:dbuser:${resourceId}/${dbUser}`,
						),
					},
				],
			}),
		},
		{ ignoreChanges: ['users', 'roles', 'groups'] },
	);
	managedPolicyArns.push(rdsConnectPolicy.policyArn);
}

const dagsterRole = eksServiceAccount('dagster', {
	serviceAccountName,
	oidcProviderArn,
	namespace: namespacePattern,
	managedPolicyArns,
});

export const dagsterRoleArn = dagsterRole.arn;

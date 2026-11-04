import { interpolate, jsonStringify, type Output } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { failIfIncorrectAccountOrRegion, cfg } from '../../common/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';
import { eksServiceAccount } from '../../common/eksServiceAccount.ts';
import { accountId, region } from '../../common/awsAccount.ts';
import { AWS_S3_WRITE_ACTIONS } from '../../constants/external.ts';
import {
  DAGSTER_COMPUTE_LOGS_PREFIX,
  DAGSTER_NAMESPACE_PATTERN,
  DAGSTER_SERVICE_ACCOUNT,
} from '../../constants/dagster.ts';

await failIfIncorrectAccountOrRegion();

// spec: DAGS#aws-identity
const oidcProviderArn = new CrossStack(cfg.require('k8s-core')).k8sCoreOutput().oidcProviderArn;

const namespacePattern = cfg.get('namespacePattern') ?? DAGSTER_NAMESPACE_PATTERN;

// Created and owned by the data/bucket stack.
const computeLogsBucket = cfg.require('computeLogsBucket');
// A wildcard here would widen the policy to other buckets.
if (!/^[a-z0-9][a-z0-9.-]{2,62}$/.test(computeLogsBucket)) {
  throw new Error(
    `computeLogsBucket is not an S3 bucket name: ${JSON.stringify(computeLogsBucket)}`,
  );
}

const managedPolicyArns: Output<string>[] = [];

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
            `arn:aws:s3:::${computeLogsBucket}`,
            `arn:aws:s3:::${computeLogsBucket}/${DAGSTER_COMPUTE_LOGS_PREFIX}/*`,
          ],
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);
managedPolicyArns.push(computeLogsPolicy.policyArn);

const dbIamAuth = cfg.getBoolean('dbIamAuth') ?? false;
if (dbIamAuth) {
  const dbInstance = awsClassic.rds.getInstanceOutput({
    dbInstanceIdentifier: cfg.require('dbInstanceIdentifier'),
  });
  const dbUser = cfg.require('dbUser');
  // A wildcard here would let the role connect as any user.
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(dbUser)) {
    throw new Error(`dbUser must be a plain Postgres role name, got ${JSON.stringify(dbUser)}`);
  }

  const rdsConnectPolicy = new awsNative.iam.ManagedPolicy(
    'dagster-rds-iam-auth',
    {
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'rds-db:connect',
            Resource: interpolate`arn:aws:rds-db:${region}:${accountId}:dbuser:${dbInstance.resourceId}/${dbUser}`,
          },
        ],
      }),
    },
    { ignoreChanges: ['users', 'roles', 'groups'] },
  );
  managedPolicyArns.push(rdsConnectPolicy.policyArn);
}

const dagsterRole = eksServiceAccount('dagster', {
  serviceAccountName: DAGSTER_SERVICE_ACCOUNT,
  oidcProviderArn,
  namespace: namespacePattern,
  pinServiceAccount: true,
  managedPolicyArns,
});

// Read by the dagster stack, which takes these as given.
export const dagsterRoleArn = dagsterRole.arn;
export { computeLogsBucket, dbIamAuth, region };

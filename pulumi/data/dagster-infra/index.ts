import { interpolate, jsonStringify, type Output } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { failIfIncorrectAccountOrRegion, cfg, tags } from '../../common/coreRef.ts';
import { nativeTags } from '../../common/tags.ts';
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

// Holds the compute logs of runs, which are kept as long as the runs that
// reference them.
// spec: DAGS#compute-logs
const logsBucket = new awsNative.s3.Bucket(
  'compute-logs',
  {
    tags: nativeTags(tags, { Purpose: 'dagster-compute-logs' }),
    bucketEncryption: {
      serverSideEncryptionConfiguration: [
        { serverSideEncryptionByDefault: { sseAlgorithm: 'AES256' } },
      ],
    },
    lifecycleConfiguration: {
      rules: [
        {
          id: 'abort-incomplete-uploads',
          status: 'Enabled',
          abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
        },
      ],
    },
  },
  { protect: true },
);

new awsClassic.s3.BucketPublicAccessBlock('compute-logs-public-access-block', {
  bucket: logsBucket.bucketName,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

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
          Resource: logsBucket.bucketName.apply((bucket) => [
            `arn:aws:s3:::${bucket}`,
            `arn:aws:s3:::${bucket}/${DAGSTER_COMPUTE_LOGS_PREFIX}/*`,
          ]),
        },
      ],
    }),
  },
  { ignoreChanges: ['users', 'roles', 'groups'] },
);
managedPolicyArns.push(computeLogsPolicy.policyArn);

const dbIamAuth = cfg.getBoolean('dbIamAuth') ?? false;
const dbUser = dbIamAuth ? cfg.require('dbUser') : undefined;
if (dbUser) {
  const dbInstance = awsClassic.rds.getInstanceOutput({
    dbInstanceIdentifier: cfg.require('dbInstanceIdentifier'),
  });
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
export const computeLogsBucket = logsBucket.bucketName;
export { dbIamAuth, dbUser, region };

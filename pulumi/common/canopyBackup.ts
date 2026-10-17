import { type Input, type Output, jsonStringify } from '@pulumi/pulumi';
import { AWS_S3_DELETE_ACTIONS } from '../constants/external.ts';

// s3-metrics reads BucketSizeBytes per StorageType (ListMetrics to discover the
// classes, GetMetricStatistics to read them), assuming the per-bucket maintenance
// role cross-account.
export const CLOUDWATCH_METRIC_ACTIONS = [
  'cloudwatch:GetMetricStatistics',
  'cloudwatch:ListMetrics',
];

// Device creds (handed to a remote server's kopia client): S3 multipart + delete,
// but NO DeleteObjectVersion / BypassGovernanceRetention / PutObjectRetention.
// kopia needs DeleteObject to manage its own metadata (session markers, index
// compaction, manifests); on the versioned + GOVERNANCE-locked bucket a
// version-less delete only writes a delete-marker, so the locked version stays
// immutable (reclaimed by the lifecycle once the lock lapses): a compromised
// device still can't destroy or shorten-lock anything, only write recoverable
// delete-markers. Plus a read of the Object Lock config for the preflight.
// spec: LNXBAK#repository-roles
export const DEVICE_S3_ACTIONS = [
  ...AWS_S3_DELETE_ACTIONS,
  's3:GetBucketObjectLockConfiguration',
];

// Trust for the per-bucket roles: chained AssumeRole from the named Canopy IRSA
// roles, and nothing else.
function assumeRolePolicy(trustedRoleArns: Input<string>[]): Output<string> {
  return jsonStringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: trustedRoleArns } }],
  });
}

// Device/issuer role trust: chained AssumeRole from canopy-issuer (mints device
// creds) and canopy-private (wizard validation).
// spec: LNXBAK#repository-roles
export function deviceAssumeRolePolicy(
  issuerRoleArn: Input<string>,
  privateRoleArn: Input<string>,
): Output<string> {
  return assumeRolePolicy([issuerRoleArn, privateRoleArn]);
}

// Maintenance/fullaccess role trust: chained AssumeRole from canopy-jobs
// (maintenance/inspection/s3-metrics) and canopy-private (wizard content-probe /
// connect-verify). Must NEVER trust canopy-issuer: the delete/BypassGovernance
// capability stays unreachable from the internet-facing public-server.
// spec: LNXBAK#repository-roles
export function maintenanceAssumeRolePolicy(
  jobsRoleArn: Input<string>,
  privateRoleArn?: Input<string>,
): Output<string> {
  return assumeRolePolicy(privateRoleArn ? [jobsRoleArn, privateRoleArn] : [jobsRoleArn]);
}

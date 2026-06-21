import { type Input, type Output, jsonStringify } from '@pulumi/pulumi';
import { AWS_EC2, AWS_S3_MULTIPART_ACTIONS } from '../constants/external.ts';

// s3-metrics reads BucketSizeBytes per StorageType (ListMetrics to discover the
// classes, GetMetricStatistics to read them), assuming the per-bucket maintenance
// role cross-account.
export const CLOUDWATCH_METRIC_ACTIONS = [
  'cloudwatch:GetMetricStatistics',
  'cloudwatch:ListMetrics',
];

// Device creds (handed to a remote server's kopia client): S3 multipart, no delete
// and no PutObjectRetention (the bucket's default GOVERNANCE retention auto-locks
// every PUT), plus a read of the Object Lock config for the preflight.
export const DEVICE_S3_ACTIONS = [
  ...AWS_S3_MULTIPART_ACTIONS,
  's3:GetBucketObjectLockConfiguration',
];

const ec2 = { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { Service: AWS_EC2 } };

function assumeRolePolicy(trustedRoleArns: (Input<string> | undefined)[]): Output<string> {
  const principals = trustedRoleArns.filter((arn): arn is Input<string> => arn !== undefined);
  return jsonStringify({
    Version: '2012-10-17',
    Statement: principals.length
      ? [ec2, { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: principals } }]
      : [ec2],
  });
}

// Device/issuer role trust: EC2 service principal plus chained AssumeRole from
// canopy-issuer (mints device creds) and canopy-private (wizard validation).
// Both passed only when the stack is onboarded to Canopy.
export function deviceAssumeRolePolicy(
  issuerRoleArn?: Input<string>,
  privateRoleArn?: Input<string>,
): Output<string> {
  return assumeRolePolicy([issuerRoleArn, privateRoleArn]);
}

// Maintenance/fullaccess role trust: EC2 plus chained AssumeRole from canopy-jobs
// (maintenance/inspection/s3-metrics) and canopy-private (wizard content-probe /
// connect-verify). Must NEVER trust canopy-issuer — the delete/BypassGovernance
// capability stays unreachable from the internet-facing public-server.
export function maintenanceAssumeRolePolicy(
  jobsRoleArn?: Input<string>,
  privateRoleArn?: Input<string>,
): Output<string> {
  return assumeRolePolicy([jobsRoleArn, privateRoleArn]);
}

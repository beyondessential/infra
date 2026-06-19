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

// Device/issuer role trust: existing EC2 service principal plus a chained
// AssumeRole from canopy-issuer (passed when the stack is onboarded to Canopy).
export function deviceAssumeRolePolicy(issuerRoleArn?: Input<string>): Output<string> {
  return jsonStringify({
    Version: '2012-10-17',
    Statement: issuerRoleArn
      ? [ec2, { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: issuerRoleArn } }]
      : [ec2],
  });
}

// Maintenance/fullaccess role trust: EC2 plus a chained AssumeRole from
// canopy-jobs. Must NEVER trust canopy-issuer — the delete/BypassGovernance
// capability stays unreachable from the internet-facing public-server.
export function maintenanceAssumeRolePolicy(jobsRoleArn?: Input<string>): Output<string> {
  return jsonStringify({
    Version: '2012-10-17',
    Statement: jobsRoleArn
      ? [ec2, { Effect: 'Allow', Action: 'sts:AssumeRole', Principal: { AWS: jobsRoleArn } }]
      : [ec2],
  });
}

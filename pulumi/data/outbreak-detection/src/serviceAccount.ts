import * as k8s from '@pulumi/kubernetes';
import { jsonStringify } from '@pulumi/pulumi';
import { ManagedPolicy } from '@pulumi/aws-native/iam/index.js';
import { AWS_S3_DELETE_ACTIONS } from '../../../constants/external.ts';
import { eksServiceAccount } from '../../../common/eksServiceAccount.ts';
import { oidcProvider } from '../../../common/k8s/coreRef.ts';
import { s3bucket, serviceAccountName } from './config.ts';
import { namespace } from './namespace.ts';

// Read/write/delete on this bucket only — the pipeline's S3-backed DuckDB
// store, shared across every deployment via a prefix per deployment rather
// than a role per deployment.
const bucketPolicy = new ManagedPolicy('outbreak-detection-s3', {
  managedPolicyName: 'OutbreakDetectionS3Access',
  policyDocument: jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: [`arn:aws:s3:::${s3bucket}`],
      },
      {
        Effect: 'Allow',
        Action: AWS_S3_DELETE_ACTIONS,
        Resource: [`arn:aws:s3:::${s3bucket}/*`],
      },
    ],
  }),
});

const role = eksServiceAccount('outbreak-detection', {
  serviceAccountName,
  namespace,
  oidcProviderArn: oidcProvider,
  managedPolicyArns: [bucketPolicy.policyArn],
});

export const sa = new k8s.core.v1.ServiceAccount(serviceAccountName, {
  metadata: {
    name: serviceAccountName,
    namespace,
    annotations: { 'eks.amazonaws.com/role-arn': role.arn },
  },
});

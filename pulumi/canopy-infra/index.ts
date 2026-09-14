import { getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';

import { region } from '../common/awsAccount.ts';
import { failIfIncorrectAccount, cfg } from '../common/coreRef.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import {
  CANOPY_SA_ISSUER,
  CANOPY_SA_JOBS,
  CANOPY_SA_PRIVATE,
  canopyNamespace,
} from '../constants/canopy.ts';

failIfIncorrectAccount();

// The cluster's OIDC provider lives in this (central) account, so the IRSA roles
// federate it directly — no per-account provider registration needed anywhere.
const oidcProviderArn = new CrossStack(cfg.require('k8s-core')).k8sCoreOutput().oidcProviderArn;
const namespace = canopyNamespace(getStack());

// canopy-issuer chain-assumes per-bucket *device* roles; canopy-jobs chain-assumes
// per-bucket *maintenance* roles. Cross-account AssumeRole needs the identity-side
// permission too — the per-bucket role's trust policy is the effective gate (these
// roles can only assume targets that explicitly name them as a principal).
function assumeRolePolicy(name: string): awsNative.iam.ManagedPolicy {
  return new awsNative.iam.ManagedPolicy(
    name,
    {
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: 'sts:AssumeRole', Resource: '*' }],
      }),
    },
    { ignoreChanges: ['users', 'roles', 'groups'] },
  );
}

// Canopy holds the bytes of a group-scoped artifact itself, under the artifact's
// id. No caller addresses the store: the group boundary is enforced on the read,
// which resolves the artifact against the caller's scope before asking for its
// bytes, so the bucket is closed and Canopy serves from it.
//
// Deliberately not a backup repo and not the recovery vault. An artifact carries
// an artifact's retention, access and cost basis rather than a backup's, and the
// vault is versioned and object-locked, which is wrong for an object replaced on
// every rebuild.
const artifactBucket = new awsNative.s3.Bucket(
  'canopy-artifacts',
  {
    bucketEncryption: {
      serverSideEncryptionConfiguration: [
        { serverSideEncryptionByDefault: { sseAlgorithm: 'AES256' } },
      ],
    },
    // An artifact is stored whole in one call, so an incomplete upload is a
    // failure rather than something to resume.
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

new awsClassic.s3.BucketPublicAccessBlock('canopy-artifacts-public-access-block', {
  bucket: artifactBucket.bucketName,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

const ARTIFACT_PREFIX = 'artifacts/';

// private-server registers and deregisters, public-server only serves, and the
// sweep in canopy-jobs lists to find objects no artifact references any more.
// Scoped to the prefix so the bucket can carry something else later without
// widening these.
//
// `s3:ListBucket` is a bucket-level action and is denied outright against an
// object ARN, so it takes a statement of its own. Conditioning it on the prefix
// keeps a lister from enumerating anything else the bucket ever holds.
function artifactPolicy(name: string, objectActions: string[], list = false) {
  return new awsNative.iam.ManagedPolicy(
    name,
    {
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: objectActions,
            Resource: artifactBucket.bucketName.apply(
              (bucket) => `arn:aws:s3:::${bucket}/${ARTIFACT_PREFIX}*`,
            ),
          },
          ...(list
            ? [
                {
                  Effect: 'Allow',
                  Action: ['s3:ListBucket'],
                  Resource: artifactBucket.bucketName.apply((bucket) => `arn:aws:s3:::${bucket}`),
                  Condition: { StringLike: { 's3:prefix': [`${ARTIFACT_PREFIX}*`] } },
                },
              ]
            : []),
        ],
      }),
    },
    { ignoreChanges: ['users', 'roles', 'groups'] },
  );
}

const issuerRole = eksServiceAccount('canopy-issuer', {
  serviceAccountName: CANOPY_SA_ISSUER,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [
    assumeRolePolicy('canopy-issuer-assume').policyArn,
    // public-server only serves held artifacts; it never registers one.
    artifactPolicy('canopy-issuer-artifacts', ['s3:GetObject']).policyArn,
  ],
});

const jobsRole = eksServiceAccount('canopy-jobs', {
  serviceAccountName: CANOPY_SA_JOBS,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [
    assumeRolePolicy('canopy-jobs-assume').policyArn,
    // The sweep lists the prefix and drops what no artifact references. It never
    // reads an artifact, so it is given no GetObject.
    artifactPolicy('canopy-jobs-artifacts', ['s3:DeleteObject'], true).policyArn,
  ],
});

// private-server: the backup setup wizard probes the target bucket by assuming
// both the device and maintenance roles (get-caller-identity / content-probe /
// connect-verify). Dedicated identity to leave room for future private-server
// AWS features.
const privateRole = eksServiceAccount('canopy-private', {
  serviceAccountName: CANOPY_SA_PRIVATE,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [
    assumeRolePolicy('canopy-private-assume').policyArn,
    artifactPolicy('canopy-private-artifacts', ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'])
      .policyArn,
  ],
});

export const canopyIssuerRoleArn = issuerRole.arn;
export const canopyJobsRoleArn = jobsRole.arn;
export const canopyPrivateRoleArn = privateRole.arn;
export const canopyArtifactBucket = artifactBucket.bucketName;
export const canopyArtifactPrefix = ARTIFACT_PREFIX;
export const canopyArtifactRegion = region;

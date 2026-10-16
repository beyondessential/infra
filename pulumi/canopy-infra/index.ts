import { getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsClassic from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';

import { region } from '../common/awsAccount.ts';
import { nativeTags } from '../common/tags.ts';
import { failIfIncorrectAccount, cfg, zone } from '../common/coreRef.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { AWS_S3_DELETE_ACTIONS, AWS_S3_READ_ACTIONS } from '../constants/external.ts';
import {
  CANOPY_SA_DOMAINS,
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
// id. Closed to the public: Canopy checks who is asking and serves them from its
// own endpoint, so nothing reaches the bucket directly.
//
// Deliberately not a backup repo and not the recovery vault. An artifact carries
// an artifact's retention, access and cost basis rather than a backup's, and the
// vault is versioned and object-locked, which is wrong for an object replaced on
// every rebuild.
//
// No expiry rule here, and do not add one: an artifact's bytes live as long as
// its registration, a group can sit on one version for a year without a rebuild,
// and expiring by age would delete bytes a registration still names and answer
// every device with a 404. Canopy sweeps what no artifact reaches instead, which
// is what canopy-jobs' listing access below is for.
const artifactBucket = new awsNative.s3.Bucket(
  'canopy-artifacts',
  {
    tags: nativeTags({ Purpose: 'canopy-artifacts' }),
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

// Bucket and object ARNs together: the action lists mix bucket-level entries
// (ListBucket, GetBucketLocation, ListBucketMultipartUploads) with object-level
// ones, and each is denied against the ARN it does not belong to.
function artifactPolicy(name: string, actions: string[]) {
  return new awsNative.iam.ManagedPolicy(
    name,
    {
      policyDocument: jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: actions,
            Resource: artifactBucket.bucketName.apply((bucket) => [
              `arn:aws:s3:::${bucket}`,
              `arn:aws:s3:::${bucket}/*`,
            ]),
          },
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
    // public-server takes in a schema builder's registration, and drops the bytes again if it refuses one.
    artifactPolicy('canopy-issuer-artifacts', AWS_S3_DELETE_ACTIONS).policyArn,
  ],
});

const jobsRole = eksServiceAccount('canopy-jobs', {
  serviceAccountName: CANOPY_SA_JOBS,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [
    assumeRolePolicy('canopy-jobs-assume').policyArn,
    // The sweep lists the bucket and drops what no artifact references.
    artifactPolicy('canopy-jobs-artifacts', AWS_S3_DELETE_ACTIONS).policyArn,
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
    artifactPolicy('canopy-private-artifacts', AWS_S3_DELETE_ACTIONS).policyArn,
  ],
});

// canopy-domains: the pod that writes the records Canopy manages — addresses for
// the names servers register, and the TXT challenge that proves control of a name
// to a certificate authority.
//
// A zone in another account is reached by assuming that account's canopy-dns role
// (created by its core stack, which is where the effective gate lives), hence the
// assume-role policy. This account's own core zone takes no such hop, so the
// write is granted here directly — scoped to that one zone and to the record
// types Canopy publishes, which leaves the zone's delegation out of reach.
const domainsRole = eksServiceAccount('canopy-domains', {
  serviceAccountName: CANOPY_SA_DOMAINS,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [
    assumeRolePolicy('canopy-domains-assume').policyArn,
    new awsNative.iam.ManagedPolicy(
      'canopy-domains-local-zone',
      {
        policyDocument: jsonStringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'route53:ChangeResourceRecordSets',
              Resource: zone.id.apply((id) => `arn:aws:route53:::hostedzone/${id}`),
              Condition: {
                'ForAllValues:StringEquals': {
                  'route53:ChangeResourceRecordSetsRecordTypes': ['A', 'AAAA', 'TXT'],
                },
              },
            },
          ],
        }),
      },
      { ignoreChanges: ['users', 'roles', 'groups'] },
    ).policyArn,
  ],
});

export const canopyIssuerRoleArn = issuerRole.arn;
export const canopyJobsRoleArn = jobsRole.arn;
export const canopyPrivateRoleArn = privateRole.arn;
export const canopyDomainsRoleArn = domainsRole.arn;
export const canopyArtifactBucket = artifactBucket.bucketName;
export const canopyArtifactPrefix = ARTIFACT_PREFIX;
export const canopyArtifactRegion = region;

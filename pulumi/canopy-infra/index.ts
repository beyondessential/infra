import { getStack, jsonStringify } from '@pulumi/pulumi';
import * as awsNative from '@pulumi/aws-native';

import { failIfIncorrectAccount, cfg } from '../common/coreRef.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { eksServiceAccount } from '../common/eksServiceAccount.ts';
import { CANOPY_SA_ISSUER, CANOPY_SA_JOBS, canopyNamespace } from '../constants/canopy.ts';

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

const issuerRole = eksServiceAccount('canopy-issuer', {
  serviceAccountName: CANOPY_SA_ISSUER,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [assumeRolePolicy('canopy-issuer-assume').policyArn],
});

const jobsRole = eksServiceAccount('canopy-jobs', {
  serviceAccountName: CANOPY_SA_JOBS,
  oidcProviderArn,
  namespace,
  managedPolicyArns: [assumeRolePolicy('canopy-jobs-assume').policyArn],
});

export const canopyIssuerRoleArn = issuerRole.arn;
export const canopyJobsRoleArn = jobsRole.arn;

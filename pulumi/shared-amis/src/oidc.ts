import * as awsClassic from '@pulumi/aws';
import { AWS_STS, GITHUB_OIDC_THUMBPRINTS, GITHUB_OIDC_URL } from '../../constants/external.ts';

// This account has no `core` stack, so the GitHub Actions OIDC provider is
// created here directly.
export const oidcProvider = new awsClassic.iam.OpenIdConnectProvider('github-actions', {
  clientIdLists: [AWS_STS],
  url: GITHUB_OIDC_URL,
  // Not strictly needed anymore for github
  thumbprintLists: GITHUB_OIDC_THUMBPRINTS,
});

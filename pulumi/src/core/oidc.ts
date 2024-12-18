import * as awsClassic from '@pulumi/aws';
import { AWS_STS, GITHUB_OIDC_THUMBPRINTS, GITHUB_OIDC_URL } from '../constants/external.js';
import { withGithubOidc } from './config.js';

let oidcProvider: awsClassic.iam.OpenIdConnectProvider | undefined;
if (withGithubOidc) {
  // Github Actions OIDC roles for CD
  oidcProvider = new awsClassic.iam.OpenIdConnectProvider('github-actions', {
    clientIdLists: [AWS_STS],
    url: GITHUB_OIDC_URL,
    // Not strictly needed anymore for github
    thumbprintLists: GITHUB_OIDC_THUMBPRINTS,
  });
}

export const ghaOidc = {
  arn: oidcProvider?.arn,
  url: oidcProvider?.url,
};

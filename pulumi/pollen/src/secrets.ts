import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { rulesetRepoToken } from './config.ts';

// Only created when a ruleset-repo token is configured. The DB connection
// string is provided separately by the CNPG-generated `pollen-db-url` secret.
export const appSecret = rulesetRepoToken
  ? new k8s.core.v1.Secret('pollen-secrets', {
      metadata: {
        namespace,
      },
      stringData: {
        RULESET_REPO_TOKEN: rulesetRepoToken,
      },
    })
  : undefined;

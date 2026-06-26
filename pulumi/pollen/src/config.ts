import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/k8s/coreRef.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';

export const normalizedStack = `pollen-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/pollen:${imageTag}`;

export const domain = cfg.require('domain');
export const publicBaseUrl = cfg.get('publicBaseUrl') ?? `https://${domain}`;

// Optional source repo (`owner/repo`) for `?config=<branch>` ruleset previews,
// and an optional token to lift its unauthenticated rate limit. Unset disables
// previews; the bundled ruleset is always available.
export const rulesetRepo = cfg.get('rulesetRepo');
export const rulesetRepoToken = cfg.getSecret('rulesetRepoToken');

export const replicas = cfg.getNumber('replicas') ?? 2;
export const dbReplicas = cfg.getNumber('dbReplicas') ?? 1;
export const dbStorage = cfg.get('dbStorage') ?? '10Gi';

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const cpuRequest = cfg.get('cpuRequest') ?? '10m';
export const memoryRequest = cfg.get('memoryRequest') ?? '32Mi';

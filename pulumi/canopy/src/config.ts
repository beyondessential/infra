import { getStack } from '@pulumi/pulumi';
import { billingTags } from '../../common/billing.ts';
import { cfg } from '../../common/k8s/coreRef.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';
import { truncateDomainIfNeeded } from '../../common/dns.ts';

// Kept as `tamanu-meta-<stack>` even though the project is now `canopy`: this
// string is the live k8s namespace (and derived tailscale/service hostnames),
// so changing it would recreate the whole control plane. Renaming the project
// is a Pulumi/CrossStack-ref concern only; the in-cluster identity is pinned.
export const normalizedStack = `tamanu-meta-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

export const domains: string[] = cfg.getObject('domains') ?? [
  truncateDomainIfNeeded(normalizedStack.replace(/^tamanu-/, ''), 'cd.tamanu.app'),
];

export const dbStorage = cfg.get('dbStorage') ?? '10Gi';
export const replicas = cfg.getNumber('replicas') ?? 2;

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const dbExpose = cfg.getBoolean('dbExpose') ?? false;
export const publicServerVersionsSecret = cfg.requireSecret('publicServerVersionsSecret');

export const slackerOpenUrl = cfg.require('slackerOpenUrl');
export const slackerCloseUrl = cfg.require('slackerCloseUrl');
export const slackerSelfAlertUrl = cfg.require('slackerSelfAlertUrl');

export const tailscaleClientId = cfg.require('tailscaleClientId');
export const tailscaleClientSecret = cfg.requireSecret('tailscaleClientSecret');
export const tailscaleHostname = cfg.require('tailscaleHostname');

export const deployment = cfg.get('deployment') ?? 'canopy';
export const stage = cfg.get('stage') ?? 'prod';
export const costLabels = billingTags({
  product: 'tamanu',
  stage,
  deployment,
});

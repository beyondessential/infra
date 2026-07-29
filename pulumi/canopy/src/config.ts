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

/**
 * How far along the move from ingress-nginx to Envoy Gateway this deployment is.
 *
 * - `staging`: the Gateway serves `gw.`-prefixed aliases of each domain and the
 *   nginx Ingress serves the domains themselves.
 * - `shadow`: the Gateway additionally listens on the bare domains, so it holds
 *   their certificates and can be reached on them directly, but only the aliases
 *   are advertised in DNS and nginx still serves the domains.
 * - `primary`: the Gateway advertises the bare domains and the nginx Ingress is
 *   gone. The aliases stay, as a name that always addresses Envoy.
 */
export type EnvoyStage = 'staging' | 'shadow' | 'primary';
const _envoyStage = cfg.get('envoyStage') ?? 'staging';
if (!['staging', 'shadow', 'primary'].includes(_envoyStage)) {
  throw new Error(`Invalid envoyStage: ${_envoyStage}`);
}
export const envoyStage = _envoyStage as EnvoyStage;

/** Alias prefix used to reach a domain on the Gateway while nginx still owns it. */
export const gatewayAlias = (domain: string) => `gw.${domain}`;

/**
 * Listeners the Gateway terminates TLS for.
 *
 * Names are derived from the bare domain rather than the hostname served, so the
 * alias listeners keep the names they were deployed under: renaming a listener
 * removes and re-adds it, for no gain.
 */
export const gatewayListeners: Array<{ name: string; hostname: string }> = [
  ...domains.map((domain) => ({ name: `${domain}-public`, hostname: gatewayAlias(domain) })),
  ...(envoyStage === 'staging'
    ? []
    : domains.map((domain) => ({ name: `${domain}-primary`, hostname: domain }))),
];

/** Hostnames the Gateway's route advertises, and so which external-dns publishes. */
export const gatewayRouteDomains: string[] =
  envoyStage === 'primary' ? [...domains.map(gatewayAlias), ...domains] : domains.map(gatewayAlias);

/** Whether the deprecated nginx Ingress still serves the bare domains. */
export const nginxIngressEnabled = envoyStage !== 'primary';

/**
 * Maximum request body size, matching the 50m the nginx controller enforces
 * cluster-wide via proxy-body-size.
 */
export const maxRequestBody = '50Mi';

/**
 * Request timeout, matching the nginx controller default this workload relied on
 * before migrating. Envoy's own route default is 15s, which is far shorter.
 */
export const requestTimeout = '60s';

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

import { getStack } from '@pulumi/pulumi';
import { billingTags } from '../../common/billing.ts';
import { cfg } from '../../common/k8s/coreRef.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';
import { truncateDomainIfNeeded } from '../../common/dns.ts';

// Kept as `tamanu-meta-<stack>` even though the project is now `canopy`: this
// string is the live k8s namespace (and derived tailscale/service hostnames),
// so changing it would recreate the whole control plane. Renaming the project
// is a Pulumi/CrossStack-ref concern only; the in-cluster identity is pinned.
// spec: K8SCNP#instance
export const normalizedStack = `tamanu-meta-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

// spec: K8SCNP#public-hostnames
export const domains: string[] = cfg.getObject('domains') ?? [
  truncateDomainIfNeeded(normalizedStack.replace(/^tamanu-/, ''), 'cd.tamanu.app'),
];

/**
 * How far along the move from ingress-nginx to Envoy Gateway this deployment is.
 *
 * - `staging`: the Gateway serves `gw.`-prefixed aliases of each domain and the
 *   nginx Ingress serves the domains themselves.
 * - `shadow`: the Gateway additionally serves the bare domains, but only the
 *   aliases are advertised in DNS and nginx still serves the domains. The bare
 *   domains can be exercised on Envoy by resolving them at its load balancer.
 * - `drain`: DNS for the bare domains points at the Gateway, and the nginx
 *   Ingress keeps serving clients still resolving to it, unadvertised.
 * - `primary`: the nginx Ingress is gone. The aliases stay, as a name that
 *   always addresses Envoy.
 */
export type EnvoyStage = 'staging' | 'shadow' | 'drain' | 'primary';
const _envoyStage = cfg.get('envoyStage') ?? 'staging';
if (!['staging', 'shadow', 'drain', 'primary'].includes(_envoyStage)) {
  throw new Error(`Invalid envoyStage: ${_envoyStage}`);
}
export const envoyStage = _envoyStage as EnvoyStage;

/** Alias prefix used to reach a domain on the Gateway while nginx still owns it. */
export const gatewayAlias = (domain: string) => `gw.${domain}`;

/** Whether the Gateway serves the bare domains at all. */
export const gatewayServesDomains = envoyStage !== 'staging';

/** Whether the Gateway's bare-domain route is the one external-dns publishes. */
export const gatewayAdvertisesDomains = envoyStage === 'drain' || envoyStage === 'primary';

/**
 * Listeners the Gateway terminates TLS for.
 *
 * Names are derived from the bare domain rather than the hostname served, so the
 * alias listeners keep the names they were deployed under: renaming a listener
 * removes and re-adds it, for no gain.
 */
export const gatewayListeners: Array<{ name: string; hostname: string }> = [
  ...domains.map((domain) => ({ name: `${domain}-public`, hostname: gatewayAlias(domain) })),
  ...(gatewayServesDomains
    ? domains.map((domain) => ({ name: `${domain}-primary`, hostname: domain }))
    : []),
];

/** Whether the deprecated nginx Ingress still serves the bare domains. */
export const nginxIngressEnabled = envoyStage !== 'primary';

/** Whether the nginx Ingress is the one external-dns publishes the bare domains from. */
export const nginxIngressAdvertised = !gatewayAdvertisesDomains;

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
export const dbInstances = cfg.getNumber('dbInstances') ?? 2;
export const dbMemoryRequest = cfg.get('dbMemoryRequest') ?? '8Gi';

/**
 * How long Barman keeps base backups and the WAL behind them.
 *
 * Longer than the demo clusters' week: this is the control plane's own database,
 * and the window has to cover a problem noticed late rather than a bad deploy
 * noticed immediately.
 */
export const backupRetentionDays = cfg.getNumber('backupRetentionDays') ?? 30;
export const replicas = cfg.getNumber('replicas') ?? 2;

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const dbExpose = cfg.getBoolean('dbExpose') ?? false;
export const publicServerVersionsSecret = cfg.requireSecret('publicServerVersionsSecret');

// spec: CTLS#certificate-authority-account
// spec: CTLS#staging-and-production
/**
 * Canopy's account at the certificate authority: a PKCS#8 PEM private key.
 *
 * The account is found-or-created from the key at every start, so this is the
 * whole of it and there is no state written back. Optional: without it the
 * domains pod still publishes addresses and issues nothing, which is how a
 * deployment that has zones but no authority is configured.
 */
export const acmeAccountKey = cfg.getSecret('acmeAccountKey');

/** Authority directory URL. Canopy defaults to Let's Encrypt production. */
export const acmeDirectory = cfg.get('acmeDirectory');

/** Contact URI (`mailto:…`) the authority can reach an operator at. */
export const acmeContact = cfg.get('acmeContact');

// spec: K8SCNP#workloads
/**
 * Where the slacker delivers notifications. Without `slackerOpenUrl` the stack
 * runs no slacker at all, so a test instance never posts to the channels the
 * production one notifies; with it, the close and self-alert URLs are required.
 */
export const slacker = cfg.get('slackerOpenUrl')
  ? {
      openUrl: cfg.require('slackerOpenUrl'),
      closeUrl: cfg.require('slackerCloseUrl'),
      selfAlertUrl: cfg.require('slackerSelfAlertUrl'),
      // Optional: canopy suspends on windows whether or not it can announce them.
      maintenanceDeclaredUrl: cfg.get('slackerMaintenanceDeclaredUrl'),
      maintenanceEndedUrl: cfg.get('slackerMaintenanceEndedUrl'),
    }
  : undefined;

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

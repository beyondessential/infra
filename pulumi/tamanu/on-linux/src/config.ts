import { all, getStack, Config, type Input, interpolate, type Output } from '@pulumi/pulumi';
import { billingTags as makeBillingTags } from '../../../common/billing.ts';
import { cfg, zone } from '../../../common/coreRef.ts';
import { TAILNET_DOMAIN } from '../../../constants/internal.ts';

export const ipAllowList: undefined | string[] = cfg.getObject('ipAllowList') ?? undefined;

export const normalizedStack = getStack()
  .toLowerCase()
  .replaceAll(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // max length for a domain label
  .replaceAll(/^-+|-+$/g, '');

export const zoneId = zone.id.apply((id) => cfg.get('zoneId') ?? id ?? cfg.require('zoneId'));

const zoneRoot = zone.name.apply((name) => {
  const root = name.split('.')[0].replace('-dev', '').replace('tamanu-', '');
  if (root === 'tamanu') return null;

  return root;
});

// spec: LNXAWS#naming
export const domainBase = all([zone.name, zoneRoot]).apply(([name, root]) => {
  const domain = cfg.get('domainBase');
  if (domain && !domain?.includes('.')) {
    return `${domain}.${name}`;
  }

  if (!domain && name) {
    return `${normalizedStack
      .replaceAll(root ?? '', '')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-+|-+$/g, '')}.${name}`;
  }

  if (domain) {
    return domain;
  }

  return cfg.require('domainBase');
});
export const tailscaleBase = zoneRoot.apply((root) => {
  const override = cfg.get('tailscaleBase');
  if (override) {
    return override;
  }

  return ['tamanu', root, typeGuess].filter(Boolean).join('-');
});

export const namePrefix = cfg.get('namePrefix') ?? '';
export const sshKey = cfg.get('keyName') ?? 'ops';
export const hardDelete = cfg.getBoolean('hardDelete') ?? false;

// When set, this stack does not provision its own kopia bucket, IAM users, or
// role; it re-exports the referenced stack's outputs. AWS Backup, EC2, DNS,
// and ACME-DNS users are unaffected. Expected value is a fully-qualified
// stack reference, e.g. `bes/tamanu-on-linux/palau-prod`.
export const cloneOf = cfg.get('cloneOf') ?? null;

const patientPortalDomainName = cfg.get('patientPortalDomain') ?? 'patient';
export const patientPortalDomain =
  patientPortalDomainName && interpolate`${patientPortalDomainName}.${domainBase}`;

const typeGuess = (() => {
  if (normalizedStack.includes('demo')) {
    return 'demo';
  }

  if (normalizedStack.includes('clone')) {
    return 'clone';
  }

  if (normalizedStack.includes('prod')) {
    return 'prod';
  }
})();

const billingCfg = new Config('billing');
export const billingTags = makeBillingTags({
  product: billingCfg.get('product') ?? 'tamanu',
  stage: billingCfg.get('stage') ?? typeGuess ?? 'prod',
  deployment: billingCfg.get('deployment'),
});

// spec: LNXAWS#first-boot
export const tailscaleTags: Output<string[]> = zoneRoot.apply((root) => {
  const tags = cfg.get('tailscaleTags')?.split(/,\s*/);
  if (tags) {
    return [...new Set(tags).values()];
  }

  const defaultTags = ['tag:server', 'tag:server-tamanu'];

  if (root) {
    defaultTags.push(`tag:server-tamanu-${root}`);
  }

  if (typeGuess) {
    defaultTags.push(`tag:server-tamanu-${typeGuess}`);
  }

  return defaultTags;
});

export const msupplyTailscaleTags: Output<string[]> = zoneRoot.apply((root) => {
  const tags = cfg.get('msupplyTailscaleTags')?.split(/,\s*/);
  if (tags) {
    return [...new Set(tags).values()];
  }

  const defaultTags = ['tag:server-msupply'];

  if (root) {
    defaultTags.push(`tag:server-msupply-${root}`);
  }

  if (typeGuess) {
    defaultTags.push(`tag:server-msupply-${typeGuess}`);
  }

  return defaultTags;
});

const defaultDisk: number = cfg.getNumber('disk') ?? cfg.getNumber('disks.root') ?? 50;
const legacyDisk = cfg.getBoolean('legacyDisk') ?? false;

export interface Facility {
  id: string;
  name?: string;
  subdomain?: string;
  instance?: string;
  disk?: number;
  legacyDisk?: boolean;
  tailscaleName?: Input<string>;
  external?: boolean;
  externalIps?: string[];
  dnsUser?: boolean;
  msupply?: boolean | string;
}

export interface Server extends Omit<Required<Facility>, 'msupply'> {
  fqdn: Output<string>;
  msupplyFqdn?: Output<string>;
  msupplyTailscaleService?: Output<string>;
  msupplyTailscaleName?: Output<string>;
  msupplyTailscaleFqdn?: Output<string>;
  msupply?: boolean | string;
}

export const facilities: Server[] = (cfg.requireObject('facilities') as Facility[])
  .map((facility: Facility) => {
    const id = facility.id.startsWith('facility-') ? facility.id : `facility-${facility.id}`;
    const externalIps = facility.externalIps ?? [];
    const hasExternalIps = externalIps.length > 0;
    return {
      subdomain: id,
      name: id,
      instance: 't4g.medium',
      tailscaleName: interpolate`${tailscaleBase}-facility-${id.replace(/^facility-/, '')}`,
      legacyDisk,
      disk: defaultDisk,
      dnsUser: false,
      ...facility,
      externalIps,
      external: hasExternalIps || facility.external || false,
      id,
    };
  })
  .map((facility) => ({
    ...facility,
    fqdn: interpolate`${facility.subdomain}.${domainBase}`,
    // spec: LNXMSP#provisioning
    msupplyFqdn: facility.msupply
      ? typeof facility.msupply === 'string'
        ? interpolate`${facility.msupply}.${domainBase}`
        : interpolate`msupply.${facility.subdomain}.${domainBase}`
      : undefined,
    msupplyTailscaleService: facility.msupply
      ? interpolate`svc:${facility.tailscaleName}-svc-msupply`
      : undefined,
    msupplyTailscaleName: facility.msupply
      ? interpolate`${facility.tailscaleName}-svc-msupply`
      : undefined,
    msupplyTailscaleFqdn: facility.msupply
      ? interpolate`${facility.tailscaleName}-svc-msupply.${TAILNET_DOMAIN}`
      : undefined,
  }));

const cfgCentral = (cfg.getObject('central') as Omit<Facility, 'id'> | false) ?? {};
const centralExternalIps = cfgCentral && cfgCentral.externalIps ? cfgCentral.externalIps : [];
const centralHasExternalIps = centralExternalIps.length > 0;
export const central: Server = {
  external:
    cfgCentral === false || centralHasExternalIps || (cfgCentral && cfgCentral.external) || false,
  name: 'Central',
  subdomain: 'central',
  // Default kept at t4g.medium. Central servers under sustained load exceed
  // its 20% baseline and accrue surplus CPU credits; size those up per-stack
  // via the `central: { instance: t4g.large }` config (don't bump the default
  // — most centrals run within baseline and would just cost more).
  instance: 't4g.medium',
  tailscaleName: interpolate`${tailscaleBase}-central`,
  legacyDisk,
  disk: defaultDisk,
  dnsUser: false,
  ...cfgCentral,
  externalIps: centralExternalIps,
  id: 'central',
  fqdn: interpolate`${(cfgCentral || null)?.subdomain ?? 'central'}.${domainBase}`,
};

export const instances: Server[] = [...(central ? [central] : []), ...facilities];

/**
 * When set, this deployment is gone: no instances, firewall, backups or
 * ACME-DNS users are created. Its hostnames are served with permanent redirects
 * instead, derived from the same `facilities`/`central` config that defined them
 * so that none can be missed or mistyped.
 *
 * Set `retiredTargetBase` to the base domain that replaced this one. Hostnames
 * keep their subdomain label unless `retiredHostMap` remaps it, which is needed
 * where the replacement names its servers differently.
 */
// spec: LNXAWS#retired-deployments
export const retired = cfg.getBoolean('retired') ?? false;
const retiredTargetBase = cfg.get('retiredTargetBase');
const retiredHostMap: { [label: string]: string } = cfg.getObject('retiredHostMap') ?? {};

export interface RedirectEntry {
  host: Output<string>;
  target: Output<string>;
}

/** Subdomain labels this deployment serves, in the order they were configured. */
const servedLabels: string[] = [
  ...instances.map((server) => server.subdomain),
  ...(patientPortalDomain && instances.some((server) => server.name === 'Central')
    ? [patientPortalDomainName]
    : []),
];

// Retiring a deployment takes two applies, and `retiredTargetBase` is what
// separates them. The redirect records carry the same names as the records the
// servers had, and Pulumi deletes resources dropped from a program only after
// everything else, so asking for both at once means creating an alias over a
// record that still exists — which Route53 refuses.
//
// So: set `retired` alone first, which takes the servers and their records away.
// Then add `retiredTargetBase`, which puts the redirects at those names. A
// deployment being retired with nothing to redirect to simply never gets the
// second step.
// spec: LNXAWS#retired-deployments
export const redirects: RedirectEntry[] =
  retired && retiredTargetBase
    ? servedLabels.map((label) => ({
        host: interpolate`${label}.${domainBase}`,
        target: interpolate`https://${retiredHostMap[label] ?? label}.${retiredTargetBase}`,
      }))
    : [];

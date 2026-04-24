import { all, getStack, type Input, interpolate, type Output } from '@pulumi/pulumi';
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
      ...facility,
      externalIps,
      external: hasExternalIps || facility.external || false,
      id,
    };
  })
  .map((facility) => ({
    ...facility,
    fqdn: interpolate`${facility.subdomain}.${domainBase}`,
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
  instance: 't4g.medium',
  tailscaleName: interpolate`${tailscaleBase}-central`,
  legacyDisk,
  disk: defaultDisk,
  ...cfgCentral,
  externalIps: centralExternalIps,
  id: 'central',
  fqdn: interpolate`${(cfgCentral || null)?.subdomain ?? 'central'}.${domainBase}`,
};

export const instances: Server[] = [...(central ? [central] : []), ...facilities];

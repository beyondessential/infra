import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/coreRef.js';
import { truncateDomainIfNeeded } from '../../common/dns.js';

export const timezone = cfg.get('timezone') ?? 'Pacific/Auckland';
export const ipAllowList: undefined | string[] = cfg.getObject('ipAllowList') ?? undefined;

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // max length for a domain label
  .replace(/^-+|-+$/g, '');

export const domainBase =
  cfg.get('domainBase') ?? truncateDomainIfNeeded(normalizedStack, 'internal.tamanu.io');

export interface Facility {
  id: string;
  name?: string;
  subdomain?: string;
  instance?: string;
}

export const facilities: Required<Facility>[] = ((cfg.getObject('facilities') as Facility[]) ?? [
  { name: 'Facility 1', id: 'facility-1', subdomain: 'facility-1', instance: 't4g.medium' },
  { name: 'Facility 2', id: 'facility-2', subdomain: 'facility-2', instance: 't4g.medium' },
]).map((facility: Facility) => ({
  subdomain: facility.id,
  name: facility.id,
  instance: 't4g.medium',
  ...facility,
}));

export const DEFAULT_CONFIG_TEMPLATE = 'basic';
export const configTemplate = cfg.get('configTemplate') ?? DEFAULT_CONFIG_TEMPLATE;

export const domains = {
  central: `central.${domainBase}`,
  ...Object.fromEntries(
    Array.from({ length: facilities.length }, (_, i) => [
      `facility${i + 1}`,
      `facility-${i + 1}.${domainBase}`,
    ]),
  ),
};

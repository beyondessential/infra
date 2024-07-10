import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/coreRef.js';
import { truncateDomainIfNeeded } from '../../common/dns.js';

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

export const facilities: Required<Facility>[] = (
  (cfg.getObject('facilities') as Facility[]) ?? [{ id: 'facility-1' }, { id: 'facility-2' }]
).map((facility: Facility) => ({
  subdomain: facility.id,
  name: facility.id,
  instance: 't4g.medium',
  ...facility,
}));

export const instances = [
  {
    id: 'central',
    name: 'Central',
    subdomain: 'central',
    instance: cfg.get('centralInstance') ?? 't4g.large',
  },
  ...facilities,
];

export const domains = Object.fromEntries(
  instances.map(({ name, subdomain }) => [name, `${subdomain}.${domainBase}`]),
);

export const zoneId = cfg.get('zoneId') ?? 'Z0565335834ZM6R45IL3';
export const namePrefix = cfg.get('namePrefix') ?? '';

export const diskSizes = {
  root: cfg.getNumber('diskGB.root') ?? 10,
  logs: cfg.getNumber('diskGB.logs') ?? 10,
  data: cfg.getNumber('diskGB.data') ?? 50,
};

export const sshKey = cfg.get('keyName') ?? 'ops';
export const hardDelete = cfg.getBoolean('hardDelete') ?? false;

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

export const domainBase = cfg.require('domainBase');
export const zoneId = cfg.require('zoneId');
export const namePrefix = cfg.get('namePrefix') ?? '';
export const sshKey = cfg.get('keyName') ?? 'ops';
export const hardDelete = cfg.getBoolean('hardDelete') ?? false;

export interface Disks {
  root?: number;
  logs?: number;
  data?: number;
}

const defaultDisks: Disks = {
  root: cfg.getNumber('disks.root') ?? 10,
  logs: cfg.getNumber('disks.logs') ?? 10,
  data: cfg.getNumber('disks.data') ?? 50,
};

export interface Facility {
  id: string;
  name?: string;
  subdomain?: string;
  instance?: string;
  disks?: Disks;
}

export const facilities: Required<Facility>[] = (cfg.requireObject('facilities') as Facility[]).map(
  (facility: Facility) => {
    const id = facility.id.startsWith('facility-') ? facility.id : `facility-${facility.id}`;
    return {
      subdomain: id,
      name: id,
      instance: 't4g.medium',
      ...facility,
      id,
      disks: {
        ...defaultDisks,
        ...facility.disks,
      },
    };
  },
);

const cfgCentral = (cfg.getObject('central') as Omit<Facility, 'id'>) ?? {};
export const central: Required<Facility> = {
  name: 'Central',
  subdomain: 'central',
  instance: 't4g.large',
  ...cfgCentral,
  id: 'central',
  disks: {
    ...defaultDisks,
    ...cfgCentral.disks,
  },
};

export const instances: Required<Facility>[] = [central, ...facilities];

export const domains = Object.fromEntries(
  instances.map(({ name, subdomain }) => [name, `${subdomain}.${domainBase}`]),
);

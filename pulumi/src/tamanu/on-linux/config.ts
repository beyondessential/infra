import { getStack, interpolate } from '@pulumi/pulumi';
import { cfg, zone } from '../../common/coreRef.js';

export const ipAllowList: undefined | string[] = cfg.getObject('ipAllowList') ?? undefined;

export const normalizedStack = getStack()
  .toLowerCase()
  .replaceAll(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // max length for a domain label
  .replaceAll(/^-+|-+$/g, '');

export const zoneId = zone.id.apply((id) => cfg.get('zoneId') ?? id ?? cfg.require('zoneId'));
export const domainBase = zone.name.apply((name) => {
  const domain = cfg.get('domainBase');
  if (domain && !domain?.includes('.')) {
    return `${domain}.${name}`;
  }

  if (!domain && name) {
    const root = name.split('.')[0].replace('-dev', '');
    return `${normalizedStack
      .replaceAll(root, '')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-+|-+$/g, '')}.${name}`;
  }

  if (domain) {
    return domain;
  }

  return cfg.require('domainBase');
});

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

export const domains = new Map(
  instances.map(({ name, subdomain }) => [name, interpolate`${subdomain}.${domainBase}`]),
);

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const INSTANCES: Instance[] = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../instances.json'), 'utf-8'),
);

export interface Instance {
  placement_group_support: boolean;
  ipv6_support: boolean;
  enhanced_networking: boolean;
  ebs_optimized: boolean;
  generation?: 'current';

  regions: { [region: string]: string };
  pricing: { [region: string]: Pricing };

  pretty_name: string;
  physical_processor: string;
  arch: string[];
  instance_type: string;
  family: string;

  burst_minutes: number | null;
  vCPU: number;
  memory: number;
}

export interface RegionInstance {
  placement_group_support: boolean;
  pretty_name: string;
  physical_processor: string;
  arch: string[];
  instance_type: string;
  family: string;
  linuxPricing: {
    ondemand: number;
    spot: number;
  };
  windowsPricing: {
    ondemand: number;
    spot: number;
  };
  burst_minutes: number | null;
  vCPU: number;
  memory: number;
}

export interface Pricing {
  linux?: {
    ondemand: string;
    spot_avg: string;
  };
  mswin?: {
    ondemand: string;
    spot_avg: string;
  };
}

// Filter for region, but also eliminate a bunch of instances we never want to use
export function instancesForRegion(region: string): RegionInstance[] {
  return INSTANCES.filter(
    (i) =>
      Object.keys(i.regions).includes(region) &&
      i.pricing[region]?.linux != null &&
      i.enhanced_networking &&
      i.ebs_optimized &&
      i.ipv6_support &&
      i.generation === 'current' &&
      !i.instance_type.includes('metal') &&
      isNitro(i.instance_type),
  ).map((i) => ({
    placement_group_support: i.placement_group_support,
    pretty_name: i.pretty_name,
    physical_processor: i.physical_processor,
    arch: i.arch,
    instance_type: i.instance_type,
    family: i.family,
    linuxPricing: {
      ondemand: parseFloat(i.pricing[region].linux?.ondemand ?? 'Infinity'),
      spot: parseFloat(i.pricing[region].linux?.spot_avg ?? 'Infinity'),
    },
    windowsPricing: {
      ondemand: parseFloat(i.pricing[region].mswin?.ondemand ?? 'Infinity'),
      spot: parseFloat(i.pricing[region].mswin?.spot_avg ?? 'Infinity'),
    },
    burst_minutes: i.burst_minutes,
    vCPU: i.vCPU,
    memory: i.memory,
  }));
}

export function instancesSizedAtLeast(
  region: string,
  arch: string,
  cpu: number,
  memory: number,
): RegionInstance[] {
  const instances = instancesForRegion(region);
  return instances.filter((i) => i.arch.includes(arch) && i.vCPU >= cpu && i.memory >= memory);
}

export function instancesSizedExactly(
  region: string,
  arch: string,
  cpu: number,
  memory: number,
): RegionInstance[] {
  const instances = instancesForRegion(region);
  return instances.filter((i) => i.arch.includes(arch) && i.vCPU === cpu && i.memory === memory);
}

export function nonBurst(instances: RegionInstance[]): RegionInstance[] {
  return instances.filter((i) => i.burst_minutes === null);
}

export function onlyBurst(instances: RegionInstance[]): RegionInstance[] {
  return instances.filter((i) => i.burst_minutes !== null);
}

export function sortByPrice(
  instances: RegionInstance[],
  platform: 'linux' | 'windows',
  launch: 'ondemand' | 'spot',
): RegionInstance[] {
  return instances.sort(
    (a, b) => a[`${platform}Pricing`][launch] - b[`${platform}Pricing`][launch],
  );
}

export function spotWithinOnDemandPrice(
  instances: RegionInstance[],
  platform: 'linux' | 'windows',
  fuzz: number = 1.1,
): RegionInstance[] {
  const sorted = sortByPrice(instances, platform, 'ondemand');
  if (sorted.length === 0) return [];
  const onDemandPrice = sorted[0][`${platform}Pricing`].ondemand * fuzz;
  return instances.filter((i) => i[`${platform}Pricing`].spot < onDemandPrice);
}

export function upToMonthly(
  instances: RegionInstance[],
  platform: 'linux' | 'windows',
  launch: 'ondemand' | 'spot',
  price: number,
): RegionInstance[] {
  return sortByPrice(
    instances.filter((i) => i[`${platform}Pricing`][launch] * 24 * 30.5 < price),
    platform,
    launch,
  );
}

// https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-nitro-instances.html
// then sort
// currently updated to Nitro v6
const NITRO_FAMILIES = [
  'A1',
  'C5',
  'C5a',
  'C5ad',
  'C5d',
  'C5n',
  'C6a',
  'C6g',
  'C6gd',
  'C6gn',
  'C6i',
  'C6id',
  'C6in',
  'C7a',
  'C7g',
  'C7gd',
  'C7gn',
  'C7i',
  'C8g',
  'C8gd',
  'C8gn',
  'D3',
  'D3en',
  'DL1',
  'DL2q',
  'G4ad',
  'G4dn',
  'G5',
  'G5g',
  'Hpc6a',
  'Hpc6id',
  'Hpc7a',
  'Hpc7g',
  'I3en',
  'I4g',
  'I4i',
  'I7ie',
  'I8g',
  'Im4gn',
  'Inf1',
  'Inf2',
  'Is4gen',
  'M5',
  'M5a',
  'M5ad',
  'M5d',
  'M5dn',
  'M5n',
  'M5zn',
  'M6a',
  'M6g',
  'M6gd',
  'M6i',
  'M6id',
  'M6idn',
  'M6in',
  'M7a',
  'M7g',
  'M7gd',
  'M7i',
  'M7i-flex',
  'M8g',
  'M8gd',
  'P3dn',
  'P4d',
  'P4de',
  'P5',
  'P5en',
  'P6-B200',
  'P6e-GB200',
  'R5',
  'R5a',
  'R5ad',
  'R5b',
  'R5d',
  'R5dn',
  'R5n',
  'R6a',
  'R6g',
  'R6gd',
  'R6i',
  'R6id',
  'R6idn',
  'R6in',
  'R7a',
  'R7g',
  'R7gd',
  'R7i',
  'R7iz',
  'R8g',
  'R8gd',
  'T3',
  'T3a',
  'T4g',
  'Trn1',
  'Trn1n',
  'Trn2',
  'Trn2u',
  'U-12tb1',
  'U-18tb1',
  'U-24tb1',
  'U-3tb1',
  'U-6tb1',
  'U-9tb1',
  'VT1',
  'X2gd',
  'X2idn',
  'X2iedn',
  'X2iezn',
  'X8g',
  'z1d',
].map((f) => f.toLowerCase());

export function isNitro(instance_type: string): boolean {
  return NITRO_FAMILIES.some((f) => instance_type.toLowerCase().startsWith(`${f}.`));
}

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
  linuxPricing: RegionPricing;
  windowsPricing: RegionPricing;
  burst_minutes: number | null;
  vCPU: number;
  memory: number;
}

export interface RegionPricing {
  ondemand: number;
  spot: number;
  // Upper bound, in percent, of the Spot Instance Advisor's interruption-frequency
  // band for this type in this region; undefined when the advisor has no data.
  spotInterruptMax?: number;
}

export interface Pricing {
  linux?: PlatformPricing;
  mswin?: PlatformPricing;
}

interface PlatformPricing {
  ondemand: string;
  spot_avg: string;
  pct_interrupt?: '<5%' | '5-10%' | '10-15%' | '15-20%' | '>20%' | null;
}

const INTERRUPT_BAND_MAX: Record<string, number> = {
  '<5%': 5,
  '5-10%': 10,
  '10-15%': 15,
  '15-20%': 20,
  '>20%': 100,
};

function regionPricing(p: PlatformPricing | undefined): RegionPricing {
  return {
    ondemand: parseFloat(p?.ondemand ?? 'Infinity'),
    spot: parseFloat(p?.spot_avg ?? 'Infinity'),
    spotInterruptMax: p?.pct_interrupt ? INTERRUPT_BAND_MAX[p.pct_interrupt] : undefined,
  };
}

export interface FamilyOptions {
  // Also admit the x memory-optimised families (1:16 and up). Worth it only
  // where memory-heavy pods can make one the cheapest fit; CPU-bound or
  // network-bound pools gain nothing but pricier capacity from them.
  highMemory?: boolean;
}

// Instance families suitable for general K8s workloads start with:
// t - burstable (t3, t4g, etc.)
// m - general purpose (m5, m6g, m7i, etc.)
// c - compute optimized (c5, c6g, c7i, etc.)
// r - memory optimized (r5, r6g, r7i, etc.)
// x - memory optimized, high ratio (x2gd, x8g, etc.), only with `highMemory`
// Excludes: GPU (g*, p*), storage-optimized (d*, i*), ML ASIC (inf*),
// HPC (hpc*), very-high-memory (u-*), high-frequency (z*)
function isK8sFamily(instance_type: string, { highMemory = false }: FamilyOptions): boolean {
  return (highMemory ? /^[tmcrx]/i : /^[tmcr]/i).test(instance_type);
}

// Filter for region, but also eliminate a bunch of instances we never want to use
export function instancesForRegion(region: string, families: FamilyOptions = {}): RegionInstance[] {
  return INSTANCES.filter(
    (i) =>
      Object.keys(i.regions).includes(region) &&
      i.pricing[region]?.linux != null &&
      i.enhanced_networking &&
      i.ebs_optimized &&
      i.ipv6_support &&
      i.generation === 'current' &&
      !i.instance_type.includes('metal') &&
      isNitro(i.instance_type) &&
      isK8sFamily(i.instance_type, families),
  )
    .map((i) => ({
      placement_group_support: i.placement_group_support,
      pretty_name: i.pretty_name,
      physical_processor: i.physical_processor,
      arch: i.arch,
      instance_type: i.instance_type,
      family: i.family,
      linuxPricing: regionPricing(i.pricing[region].linux),
      windowsPricing: regionPricing(i.pricing[region].mswin),
      burst_minutes: i.burst_minutes,
      vCPU: i.vCPU,
      memory: i.memory,
    }))
    .sort((a, b) => a.instance_type.localeCompare(b.instance_type));
}

export function instancesSizedAtLeast(
  region: string,
  arch: string,
  cpu: number,
  memory: number,
  families: FamilyOptions = {},
): RegionInstance[] {
  const instances = instancesForRegion(region, families);
  return instances
    .filter((i) => i.arch.includes(arch) && i.vCPU >= cpu && i.memory >= memory)
    .sort((a, b) => a.instance_type.localeCompare(b.instance_type));
}

// Memory-dense shapes (16 GiB or more per vCPU) at least `cpu` vCPU / `memory`
// GiB, a smaller vCPU floor than the general one because the memory makes up
// for it.
export function memoryDenseSizedAtLeast(
  region: string,
  arch: string,
  cpu: number,
  memory: number,
): RegionInstance[] {
  return instancesForRegion(region, { highMemory: true })
    .filter(
      (i) =>
        i.arch.includes(arch) && i.vCPU >= cpu && i.memory >= memory && i.memory >= i.vCPU * 16,
    )
    .sort((a, b) => a.instance_type.localeCompare(b.instance_type));
}

export function uniqueByType(instances: RegionInstance[]): RegionInstance[] {
  return [...new Map(instances.map((i) => [i.instance_type, i])).values()];
}

export function instancesSizedExactly(
  region: string,
  arch: string,
  cpu: number,
  memory: number,
): RegionInstance[] {
  const instances = instancesForRegion(region);
  return instances
    .filter((i) => i.arch.includes(arch) && i.vCPU === cpu && i.memory === memory)
    .sort((a, b) => a.instance_type.localeCompare(b.instance_type));
}

export function nonBurst(instances: RegionInstance[]): RegionInstance[] {
  return instances
    .filter((i) => i.burst_minutes === null)
    .sort((a, b) => a.instance_type.localeCompare(b.instance_type));
}

export function onlyBurst(instances: RegionInstance[]): RegionInstance[] {
  return instances
    .filter((i) => i.burst_minutes !== null)
    .sort((a, b) => a.instance_type.localeCompare(b.instance_type));
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

// The advisor's bands are monthly, region-wide frequencies; a type it rates
// rarely interrupted can still be reclaimed far more often in practice, so
// treat this as a ranking rather than a prediction. Types without advisor
// data are dropped.
export function spotInterruptAtMost(
  instances: RegionInstance[],
  platform: 'linux' | 'windows',
  percent: number,
): RegionInstance[] {
  return instances.filter((i) => (i[`${platform}Pricing`].spotInterruptMax ?? Infinity) <= percent);
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

import { readFileSync } from 'fs';
import { Config, getStack } from '@pulumi/pulumi';
import type { FacilityDef } from './Cluster.ts';

export const cfg = new Config();
export const infraStack = cfg.get('infraStack') ?? 'bes/tamanu-infra/main';
export const superdomain = cfg.get('superdomain') ?? getStack();
export const imageTag = cfg.require('imageTag');
export const cpuArchitecture = cfg.getBoolean('arm64') ? 'ARM64' : 'X86_64';

export const initialUsers =
  cfg.getObject('initialUsers') ?? JSON.parse(readFileSync('initialUsers.json', 'utf-8'));

let facilities = cfg.getObject('facilities') as FacilityDef[];
if (!facilities) {
  const numberOfFacilities = cfg.getNumber('numberOfFacilities', { min: 0 }) ?? 2;
  facilities = [...Array(numberOfFacilities).keys()].map((index) => ({
    facilityId: `facility-${index + 1}`,
  }));
}
export { facilities };

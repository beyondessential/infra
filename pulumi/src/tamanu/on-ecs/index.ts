import { readFileSync } from 'fs';
import { Config, getStack } from '@pulumi/pulumi';
import { Cluster, FacilityDef } from './Cluster.js';

const cfg = new Config();
const infraStack = cfg.get('infraStack') ?? 'bes/tamanu-infra/main';
const superdomain = cfg.get('superdomain') ?? getStack();
export const imageTag = cfg.require('imageTag');
const initialUsers =
  cfg.getObject('initialUsers') ?? JSON.parse(readFileSync('initialUsers.json', 'utf-8'));

let facilities = cfg.getObject('facilities') as FacilityDef[] | undefined;
if (!facilities) {
  const numberOfFacilities = cfg.getNumber('numberOfFacilities', { min: 0 }) ?? 2;
  facilities = [...Array(numberOfFacilities).keys()].map((index) => ({
    facilityId: `facility-${index + 1}`,
  }));
}

const { outputs: cluster } = new Cluster(
  getStack()
    .substring(0, 32)
    .replace(/(^-+|-+$)/g, ''),
  {
    infraStack,
    superdomain,
    imageTag,
    facilities,
    referenceData: {
      bucket: 'bes-tamanu-dev-referencedata',
      files: cfg.getObject('initialReferenceData') ?? ['2023-07-03-demo-like.xlsx'],
    },
    initialUsers,
    ownLoadBalancer: cfg.getBoolean('ownLoadBalancer') ?? false,
  },
);

export const { services } = cluster;

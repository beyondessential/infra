import { readFileSync } from 'fs';
import { Config, getStack } from '@pulumi/pulumi';
import { Cluster, FacilityDef } from './Cluster';

const cfg = new Config();
const imageTag = cfg.require('imageTag');
const initialUsers =
  cfg.getObject('initialUsers') ?? JSON.parse(readFileSync('initialUsers.json', 'utf-8'));

let facilities = cfg.getObject('facilities') as FacilityDef[] | undefined;
if (!facilities) {
  const numberOfFacilities = cfg.getNumber('numberOfFacilities', { min: 0 }) ?? 2;
  facilities = [...Array(numberOfFacilities).keys()].map((index) => ({
    facilityId: `facility-${index + 1}`,
    email: `facility-${index + 1}@tamanu.io`,
  }));
}

const { outputs: cluster } = new Cluster(
  getStack()
    .substring(0, 32)
    .replace(/(^-+|-+$)/g, ''),
  {
    imageTag,
    facilities,
    referenceData: {
      bucket: 'bes-tamanu-dev-referencedata',
      files: ['2023-07-03-demo-like.xlsx'],
    },
    initialUsers,
  },
);

export const { services } = cluster;

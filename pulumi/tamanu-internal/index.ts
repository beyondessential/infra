import { Config, getStack } from '@pulumi/pulumi';
import { Cluster } from './Cluster';

const cfg = new Config();
const imageTag = cfg.require('imageTag');

const { outputs: cluster } = new Cluster(getStack(), {
  imageTag,
  referenceData: {
    bucket: 'bes-tamanu-dev-reference-data',
    files: ['REFERENCE DATA IMPORT GOOD AS OF MAY 2023.xlsx'],
  },
});
export const { facilityCount, services } = cluster;

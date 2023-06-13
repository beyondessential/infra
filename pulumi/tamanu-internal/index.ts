import { Config, getStack } from '@pulumi/pulumi';
import { Cluster } from './Cluster';

const cfg = new Config();
const imageTag = cfg.require('imageTag');

const { outputs: cluster } = new Cluster(getStack().substring(0, 40), {
  imageTag,
  referenceData: {
    bucket: 'bes-tamanu-dev-referencedata',
    files: ['2023-05-01-demo-like.xlsx'],
  },
});
export const { facilityCount, services } = cluster;

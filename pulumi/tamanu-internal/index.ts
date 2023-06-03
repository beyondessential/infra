import { Config, getStack } from '@pulumi/pulumi';
import { Cluster } from './Cluster';

const cfg = new Config();
const imageTag = cfg.require('imageTag');

// FYI Putting spaces in refdata filenames is a bad idea, because it makes
// the files harder (unreasonably unpossible) to access from the container.
const { outputs: cluster } = new Cluster(getStack(), {
  imageTag,
  referenceData: {
    bucket: 'bes-tamanu-dev-referencedata',
    files: ['2023-05-01-demo-like.xlsx'],
  },
});
export const { facilityCount, services } = cluster;

import { Config, getStack } from '@pulumi/pulumi';
import { TamanuCluster } from './TamanuCluster';

const cfg = new Config();
const imageTag = cfg.require('imageTag');
const { outputs: cluster } = new TamanuCluster(getStack(), { imageTag, numberOfFacilities: 0 });
export const { facilityCount, services } = cluster;

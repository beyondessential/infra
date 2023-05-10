import { getStack } from '@pulumi/pulumi';
import { TamanuCluster } from './TamanuCluster';

const { outputs: cluster } = new TamanuCluster(getStack());
export const { database, databaseEndpoint, facilityCount, services } = cluster;

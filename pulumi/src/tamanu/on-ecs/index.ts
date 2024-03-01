import { getStack } from '@pulumi/pulumi';
import { Cluster } from './Cluster.js';
import { cfg, facilities, imageTag, infraStack, initialUsers, superdomain } from './config.js';

export { imageTag };

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
      files: cfg.getObject('initialReferenceData') ?? ['referencedata/default.xlsx'],
    },
    initialUsers,
    ownLoadBalancer: cfg.getBoolean('ownLoadBalancer') ?? false,
  },
);

export const { services } = cluster;

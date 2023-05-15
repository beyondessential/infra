import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { ClusterInfra } from './ClusterInfra';

// Container repos for tamanu server images
const ecrRepositories = Object.fromEntries(
  ['central', 'facility', 'meta'].map((image) => [
    image,
    new Repository(`tamanu-${image}`, {
      repositoryName: `tamanu/${image}`,
      imageTagMutability: RepositoryImageTagMutability.Immutable,
    }),
  ]),
);

export const repoCentral = ecrRepositories.central.repositoryUri;
export const repoFacility = ecrRepositories.facility.repositoryUri;
export const repoMeta = ecrRepositories.meta.repositoryUri;

// Common runtime infrastructure for tamanu clusters
const { outputs: internal } = new ClusterInfra('tamanu-internal', {
  ipv4Cidr: '10.32.0.0/16',
});

export const internalVpc = internal.vpc;
export const internalEigw = internal.eigw;
export const internalSubnetsDb = internal.subnets.db;
export const internalSubnetsRt = internal.subnets.rt;
export const internalDbSecGroup = internal.dbSecGroup;
export const internalDbSubnetGroup = internal.dbSubnetGroup;
export const internalEcsCluster = internal.ecsCluster;
export const internalCloudmapNamespace = internal.cloudmapNamespace;

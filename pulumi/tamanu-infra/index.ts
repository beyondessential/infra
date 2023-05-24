import { Repository, RepositoryImageTagMutability } from '@pulumi/aws-native/ecr';
import { ClusterInfra } from './ClusterInfra';
import { Network } from './Network';

export const repos = Object.fromEntries(
  ['central', 'configurator', 'facility', 'meta'].map((image) => [
    image,
    new Repository(`tamanu-${image}`, {
      repositoryName: `tamanu/${image}`,
      imageTagMutability: RepositoryImageTagMutability.Mutable,
    }).repositoryUri,
  ]),
);

export const { outputs: network } = new Network('internal', {
  ipv4Cidr: '10.0.0.0/16',
  tags: {
    Application: 'Tamanu',
    Cluster: 'internal',
  },
});

export const { outputs: cluster } = new ClusterInfra('internal', {
  network,
  tags: {
    Application: 'Tamanu',
  },
});

import { ClusterInfra } from './ClusterInfra';
import { Network } from './Network';

import { repositories } from './repos';
import './github';

export const repos = Object.fromEntries(
  repositories.map(({ image, repo }) => [image, repo.repositoryUri]),
);

export const { outputs: network } = new Network('internal', {
  ipv4Cidr: '10.20.0.0/16',
  tags: {
    Application: 'Tamanu',
    Infra: 'internal',
  },
});

export const { outputs: cluster } = new ClusterInfra('internal', {
  network,
  zone: 'Z0565335834ZM6R45IL3',
  tags: {
    Application: 'Tamanu',
  },
});

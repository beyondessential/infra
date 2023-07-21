import { Config, Output, getStack } from '@pulumi/pulumi';

import { ClusterInfra } from './ClusterInfra.js';
import { Network } from '../../common/Network.js';

const cfg = new Config();
const name = getStack() === 'main' ? 'internal' : getStack();

let repos: { [key: string]: Output<string> } = {};
if (name === 'internal') {
  const { repositories } = await import('./repos.js');
  for (const { image, repo } of repositories) {
    repos[image] = repo.repositoryUri;
  }

  await import('./github.js');
}
export { repos };

export const { outputs: network } = new Network(name, {
  ipv4Cidr: cfg.get('networkV4Cidr') ?? '10.20.0.0/16',
  tags: {
    Application: 'Tamanu',
    Infra: name,
  },
});

export const { outputs: cluster } = new ClusterInfra(name, {
  network,
  zone: cfg.require('dnsZone'),
  tags: {
    Application: 'Tamanu',
  },
});

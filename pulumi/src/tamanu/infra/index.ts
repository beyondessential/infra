import { Output } from '@pulumi/pulumi';
import { cfg, stackName } from '../../common/coreRef.js';
import { ClusterInfra } from './ClusterInfra.js';
import { Network } from '../../common/Network.js';

const name = stackName === 'main' ? 'internal' : stackName;

let repos: { [key: string]: Output<string> } = {};
if (name === 'internal') {
  const { repositories } = await import('./repos.js');
  for (const { image, repo } of repositories) {
    repos[image] = repo.repositoryUri;
  }

  await import('./github.js');
}
export { repos };

// We really should be using the core network, but let's do that when there's no more ECS.
export const { outputs: network } = new Network(name, {
  ipv4Cidr: cfg.get('networkV4Cidr') ?? '10.20.0.0/16',
  v6: true,
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

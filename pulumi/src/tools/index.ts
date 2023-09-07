import { Network } from '../common/Network.js';
import { Netbox } from './Netbox.js';

export const { outputs: network } = new Network('tools', {
  ipv4Cidr: '10.10.0.0/16',
  v6: true,
  tags: {
    Infra: 'Tools',
  },
});

export const { outputs: netbox } = new Netbox('netbox', { network });

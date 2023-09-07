import { all as applyAll } from '@pulumi/pulumi';
import { NetworkOutputs } from './Network';

export const all = {
  fromPort: 0,
  toPort: 0,
  protocol: '-1',
  cidrBlocks: ['0.0.0.0/0'],
  ipv6CidrBlocks: ['::/0'],
};

export const allICMPv4 = {
  fromPort: -1,
  toPort: -1,
  cidrBlocks: ['0.0.0.0/0'],
  description: 'ICMPv4',
  protocol: '1',
};

export const allICMPv6 = {
  fromPort: -1,
  toPort: -1,
  ipv6CidrBlocks: ['::/0'],
  description: 'ICMPv6',
  protocol: '58',
};

export const allICMP = [allICMPv4, allICMPv6];

export function openPort(description: string, port: number, protocol: string = 'tcp') {
  return {
    description,
    fromPort: port,
    toPort: port,
    protocol,
    cidrBlocks: ['0.0.0.0/0'],
    ipv6CidrBlocks: ['::/0'],
  };
}

export function withNetwork(network: NetworkOutputs) {
  return {
    openVpcPort(description: string, port: number, protocol: string = 'tcp') {
      return {
        ...openPort(description, port, protocol),
        description: `${description} from VPC`,
        cidrBlocks: network.v4Cidr.apply((cidr) => cidr ? [cidr] : []),
        ipv6CidrBlocks: network.v6Cidr.apply((cidr) => cidr ? [cidr] : []),
      };
    },
  };
}

import { NetworkOutputs } from './Network';

export const all = {
  fromPort: 0,
  toPort: 0,
  protocol: '-1',
  cidrBlocks: ['0.0.0.0/0'],
};

export const allICMPv4 = {
  fromPort: -1,
  toPort: -1,
  cidrBlocks: ['0.0.0.0/0'],
  description: 'ICMPv4',
  protocol: '1',
};

export function openPort(description: string, port: number, protocol: string = 'tcp') {
  return {
    description,
    fromPort: port,
    toPort: port,
    protocol,
    cidrBlocks: ['0.0.0.0/0'],
  };
}

export function withNetwork(
  network: NetworkOutputs
) {
  return {
    openVpcPort(description: string, port: number, protocol: string = 'tcp') {
      return {
        ...openPort(description, port, protocol),
        description: `${description} from VPC`,
        cidrBlocks: [network.v4Cidr],
      };
    }
  };
}

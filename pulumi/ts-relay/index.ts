import * as aws from '@pulumi/aws';
import { all, output, secret } from '@pulumi/pulumi';
import { DeviceKey, TailnetKey, getDeviceOutput } from '@pulumi/tailscale';

import { region } from '../common/awsAccount.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { AMI_UBUNTU_ARM64, TAILNET_DOMAIN } from '../constants/internal.ts';
import * as securityGroupRules from '../common/securityGroupRules.ts';
import {
  cloudInitYaml,
  hostnameCommands,
  tailscaleInstallCommands,
  tailscaleUpCommands,
  emergencySshKeyCommands,
  btrfsSwapFileCommands,
} from '../common/cloudInit.ts';

import { core, relayPort, relayName, nodeName, tailscaleTags, instanceType } from './config.ts';

const $core = new CrossStack(core);
const $network = $core.network();
const tags = {
  Name: nodeName,
  Purpose: 'Tailscale',
};

const tailscaleName = `ts-relay-${relayName}`;

const sg = new aws.ec2.SecurityGroup('ts-relay', {
  vpcId: $network.vpc,
  description: 'Tailscale Peer Relay',
  ingress: [
    ...securityGroupRules.allICMP,
    {
      description: 'Tailscale Peer Relay',
      fromPort: relayPort,
      toPort: relayPort,
      protocol: 'udp',
      cidrBlocks: ['0.0.0.0/0'],
      ipv6CidrBlocks: ['::/0'],
    },
  ],
  egress: [securityGroupRules.all],
  tags,
});

const authKey = new TailnetKey('ts-relay', {
  ephemeral: false,
  expiry: 15 * 60,
  reusable: false,
  preauthorized: true,
  tags: tailscaleTags,
}, { ignoreChanges: ['tags'] });

const box = new aws.ec2.Instance(
  'ts-relay',
  {
    ami: AMI_UBUNTU_ARM64[region],
    instanceType,
    keyName: 'ops',
    rootBlockDevice: {
      volumeSize: 8,
      volumeType: 'gp3',
      encrypted: true,
    },
    metadataOptions: {
      httpTokens: 'required',
      httpProtocolIpv6: 'enabled',
      instanceMetadataTags: 'enabled',
    },
    subnetId: $network.publicWorkloadSubnetIds.apply((ids) => ids[0]),
    vpcSecurityGroupIds: [sg.id],
    userData: all([authKey.key, output(tailscaleName), output(relayPort)]).apply(
      ([authKey, hostname, port]) =>
        secret(
          cloudInitYaml([
            ...hostnameCommands(hostname),
            ...btrfsSwapFileCommands(),
            ...tailscaleInstallCommands(),
            ...tailscaleUpCommands({ authKey, hostname }),
            ['tailscale', 'set', `--relay-server-port=${port}`],
            ...emergencySshKeyCommands(),
          ]),
        ),
    ),
    tags,
  },
  {
    parent: authKey,
    ignoreChanges: ['ami'],
  },
);

const eip = new aws.ec2.Eip('ts-relay', {
  instance: box.id,
  domain: 'vpc',
  tags,
});

const tailscaleDevice = getDeviceOutput({
  name: box.arn.apply((_) => `${tailscaleName}.${TAILNET_DOMAIN}`),
  waitFor: '15m',
});

const deviceKey = new DeviceKey(
  'ts-relay',
  {
    deviceId: tailscaleDevice.id,
    keyExpiryDisabled: true,
  },
  { parent: authKey },
);

export const udpPort = output(relayPort);
export const ip = {
  v4: eip.publicIp,
  v6: box.ipv6Addresses.apply((addrs) => (addrs.length > 0 ? addrs[0] : undefined)),
};
export const tailscale = {
  name: tailscaleDevice.name,
  addresses: tailscaleDevice.addresses,
  tags: tailscaleTags,
};

import * as aws from '@pulumi/aws';
import { all, secret } from '@pulumi/pulumi';
import { TailnetKey } from '@pulumi/tailscale';

import { region } from '../common/awsAccount.ts';
import { CrossStack } from '../common/CrossStack.ts';
import { AMI_UBUNTU_ARM64 } from '../constants/internal.ts';
import * as securityGroupRules from '../common/securityGroupRules.ts';
import {
  cloudInitYaml,
  hostnameCommands,
  tailscaleInstallCommands,
  tailscaleUpCommands,
  emergencySshKeyCommands,
} from '../common/cloudInit.ts';

import { core, instanceType, sshPublicKey, tailscaleTags, nodeName } from './config.ts';

const $core = new CrossStack(core);
const $network = $core.network();
const tags = {
  Name: nodeName,
  Purpose: 'Tailscale',
};

const tailscaleName = 'ts-relay-verify';

// Deliberately opens 22 (every other throwaway box in this investigation
// relies solely on the tailscale tunnel for access) — the whole point of this
// box is to have its own UDP path sabotaged to force it onto the peer relay,
// so management access needs to survive that independently of its Tailscale
// state. Key-only auth; destroy the stack when done rather than leaving this
// open.
const sg = new aws.ec2.SecurityGroup('ts-relay-verify', {
  vpcId: $network.vpc,
  description: 'Peer-relay verification client (temporary)',
  ingress: [...securityGroupRules.allICMP, securityGroupRules.openPort('SSH', 22)],
  egress: [securityGroupRules.all],
  tags,
});

const authKey = new TailnetKey(
  'ts-relay-verify',
  {
    ephemeral: false,
    expiry: 15 * 60,
    reusable: false,
    preauthorized: true,
    tags: tailscaleTags,
  },
  { ignoreChanges: ['tags'] },
);

const box = new aws.ec2.Instance(
  'ts-relay-verify',
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
    userData: all([authKey.key]).apply(([authKey]) =>
      secret(
        cloudInitYaml([
          ...hostnameCommands(tailscaleName),
          ...tailscaleInstallCommands(),
          ...tailscaleUpCommands({ authKey, hostname: tailscaleName }),
          ...emergencySshKeyCommands(),
          ...(sshPublicKey
            ? [['sh', '-c', `echo '${sshPublicKey}' >> /home/ubuntu/.ssh/authorized_keys`]]
            : []),
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

const eip = new aws.ec2.Eip('ts-relay-verify', {
  instance: box.id,
  domain: 'vpc',
  tags,
});

export const ip = eip.publicIp;
export const tailscale = {
  hostname: tailscaleName,
  tags: tailscaleTags,
};

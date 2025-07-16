import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import * as aws from '@pulumi/aws';
import { all, Output, secret } from '@pulumi/pulumi';

import { $network } from '../../common/coreRef.ts';
import { tailscaleKey } from '../../common/tailscaleKey.ts';

import {
  instances,
  namePrefix,
  hardDelete,
  sshKey,
  tailscaleTags,
  normalizedStack,
} from './config.ts';
import { applyBackup } from './backup/aws.ts';
import { sg } from './firewall.ts';
import { applyDNS } from './dns.ts';
import { region } from '../../common/awsAccount.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// https://cloud-images.ubuntu.com/locator/ec2/
// search for `ap-southeast-2 24.04 arm`
const UBUNTU_24_04_LTS_ARM64 = {
  'ap-southeast-2': 'ami-0fae8bcb3f3621e32',
  'eu-central-2': 'ami-00f2dffdfea591a60',
};

const DEVICE_NAMES = {
  root: '/dev/root',
  logs: '/dev/sdl',
  data: '/dev/sdp', // p for postgres
};

const backupResources: Output<string>[] = [];
const records: Map<string, Omit<aws.route53.RecordArgs, 'zoneId'>> = new Map();

for (const [i, inst] of instances.entries()) {
  if (inst.external) continue;

  const authKey = tailscaleKey(inst.id, {
    tags: tailscaleTags,
    expirySecs: 6 * 60 * 60, // excessive but it lets us deal with most problems eg. EIP quotas
    description: `tamanu ${normalizedStack} ${inst.id}`.substring(0, 50),
  });

  const vm = new aws.ec2.Instance(
    inst.id,
    {
      ami: region.apply((reg) => UBUNTU_24_04_LTS_ARM64[reg]),
      instanceType: inst.instance,
      disableApiTermination: !hardDelete,
      monitoring: true,
      rootBlockDevice: {
        volumeSize: inst.disks.root,
        volumeType: 'gp3',
        encrypted: true,
      },
      metadataOptions: {
        httpTokens: 'required', // IMDSv2
        httpProtocolIpv6: 'enabled',
        instanceMetadataTags: 'enabled',
      },
      subnetId: $network.publicWorkloadSubnetIds.apply((ids) => ids[i % ids.length]),
      vpcSecurityGroupIds: [sg.id],
      userData: all([authKey.key, tailscaleTags, inst.tailscaleName, inst.fqdn]).apply(
        ([key, tags, name, fqdn]) =>
          secret(
            readFileSync(join(__dirname, 'cloud-config.yaml'), 'utf-8')
              .replace(/%TAILSCALE_AUTH_KEY%/g, key)
              .replace(/%TAILSCALE_TAGS%/g, tags.join(','))
              .replace(/%TAILSCALE_NAME%/g, name)
              .replace(/%HOSTNAME%/g, fqdn),
          ),
      ),
      tags: {
        Name: `${namePrefix}${inst.name}`,
      },
    },
    {
      ignoreChanges: ['ami', 'rootBlockDevice', 'userData'],
      deleteBeforeReplace: true,
    },
  );

  backupResources.push(vm.arn);

  for (const [name, size] of Object.entries(inst.disks)) {
    if (name === 'root') continue;
    const volume = new aws.ebs.Volume(
      `${inst.id}-${name}`,
      {
        availabilityZone: vm.availabilityZone,
        size,
        type: 'gp3',
        finalSnapshot: true,
        encrypted: true,
        tags: {
          Name: `${namePrefix}${inst.name} ${name}`,
        },
      },
      { deleteBeforeReplace: true },
    );

    backupResources.push(volume.arn);

    new aws.ec2.VolumeAttachment(
      `${inst.id}-${name}`,
      {
        deviceName: DEVICE_NAMES[name],
        volumeId: volume.id,
        instanceId: vm.id,
      },
      { deleteBeforeReplace: true },
    );
  }

  const ip = new aws.ec2.Eip(inst.id, {
    instance: vm.id,
    domain: 'vpc',
    tags: {
      Name: `${namePrefix}${inst.name}`,
    },
  });

  records.set(`${inst.id}-v4`, {
    name: inst.fqdn,
    type: aws.route53.RecordType.A,
    ttl: 300,
    records: [ip.publicIp],
  });

  vm.ipv6Addresses.length &&
    records.set(`${inst.id}-v6`, {
      name: inst.fqdn,
      type: aws.route53.RecordType.AAAA,
      ttl: 300,
      records: [vm.ipv6Addresses[0]],
    });
}

applyBackup(backupResources);
applyDNS(records);

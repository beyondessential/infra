import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import * as aws from '@pulumi/aws';
import { all, Output, secret } from '@pulumi/pulumi';

import { $network } from '../../common/coreRef.js';
import { tailscaleKey } from '../../common/tailscaleKey.js';

import {
  instances,
  namePrefix,
  hardDelete,
  sshKey,
  tailscaleTags,
  normalizedStack,
} from './config.js';
import { applyBackup } from './backup.js';
import { sg } from './firewall.js';
import { applyDNS } from './dns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// https://cloud-images.ubuntu.com/locator/ec2/
const UBUNTU_24_04_LTS_ARM64_SYDNEY = 'ami-09b56d1f2bd9893f7';

const DEVICE_NAMES = {
  root: '/dev/root',
  logs: '/dev/sdl',
  data: '/dev/sdp', // p for postgres
};

const backupResources: Output<string>[] = [];
const records: Map<string, Omit<aws.route53.RecordArgs, 'zoneId'>> = new Map();

for (const [i, inst] of instances.entries()) {
  const authKey = tailscaleKey(inst.id, {
    tags: tailscaleTags,
    expirySecs: 15 * 60,
    description: `tamanu-on-linux -- ${normalizedStack} -- ${inst.id}`,
  });

  const vm = new aws.ec2.Instance(
    inst.id,
    {
      ami: UBUNTU_24_04_LTS_ARM64_SYDNEY,
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

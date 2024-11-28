import * as aws from '@pulumi/aws';
import { normalizedStack, domainBase, domains, instances, zoneId, diskSizes, namePrefix, hardDelete, sshKey } from './config.js';
import { $network, failIfIncorrectAccount } from '../../common/coreRef.js';
import * as securityGroupRules from '../../common/securityGroupRules.js';
failIfIncorrectAccount();

export const urls = Object.fromEntries(
  Object.entries(domains).map(([key, value]) => [
    `${key[0].toUpperCase()}${key.slice(1).replace(/(\d)/, ' $1')}`,
    `https://${value}`,
  ]),
);

const sg = new aws.ec2.SecurityGroup(
  normalizedStack,
  {
    vpcId: $network.vpc,
    description: `for ${domainBase}`,
    ingress: [
      ...securityGroupRules.allICMP,
      securityGroupRules.openPort('SSH', 22),
      securityGroupRules.openPort('HTTP', 80),
      securityGroupRules.openPort('HTTPS', 443),
      securityGroupRules.openPort('HTTP3', 443, 'udp'),
    ],
    egress: [securityGroupRules.all],
    tags: {
      Name: `${namePrefix}${normalizedStack}`,
      Purpose: 'workload',
    },
  },
  {
    parent: this,
    ignoreChanges: ['ingress', 'egress'],
  },
);

// https://cloud-images.ubuntu.com/locator/ec2/
const UBUNTU_24_04_LTS_ARM64_SYDNEY = 'ami-09b56d1f2bd9893f7';

const DEVICE_NAMES = {
  root: '/dev/root',
  logs: '/dev/sdl',
  data: '/dev/sdp', // p for postgres
};

for (const [i, inst] of instances.entries()) {
  const vm = new aws.ec2.Instance(
    inst.id,
    {
      ami: UBUNTU_24_04_LTS_ARM64_SYDNEY,
      instanceType: inst.instance,
      disableApiTermination: !hardDelete,
      monitoring: true,
      rootBlockDevice: {
        volumeSize: diskSizes.root,
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
      keyName: sshKey,
      tags: {
        Name: `${namePrefix}${inst.name}`,
      },
    },
    {
      ignoreChanges: ['rootBlockDevice'],
      deleteBeforeReplace: true,
    },
  );

  for (const [name, size] of Object.entries(diskSizes)) {
    if (name === 'root') continue;
    const volume = new aws.ebs.Volume(`${inst.id}-${name}`, {
      availabilityZone: vm.availabilityZone,
      size,
      type: 'gp3',
      finalSnapshot: true,
      encrypted: true,
      tags: {
        Name: `${namePrefix}${inst.name} ${name}`,
      },
    }, { deleteBeforeReplace: true });

    new aws.ec2.VolumeAttachment(`${inst.id}-${name}`, {
      deviceName: DEVICE_NAMES[name],
      volumeId: volume.id,
      instanceId: vm.id,
    }, { deleteBeforeReplace: true });
  }

  const ip = new aws.ec2.Eip(inst.id, {
    instance: vm.id,
    domain: 'vpc',
    tags: {
      Name: `${namePrefix}${inst.name}`,
    },
  });

  new aws.route53.Record(`${inst.id}-v4`, {
    zoneId: zoneId,
    name: domains[inst.name],
    type: aws.route53.RecordType.A,
    ttl: 300,
    records: [ip.publicIp],
  });

  vm.ipv6Addresses.length && new aws.route53.Record(`${inst.id}-v6`, {
    zoneId: zoneId,
    name: domains[inst.name],
    type: aws.route53.RecordType.AAAA,
    ttl: 300,
    records: [vm.ipv6Addresses[0]],
  });
}

import * as aws from '@pulumi/aws';
import { all, type Input, interpolate, type Output, secret } from '@pulumi/pulumi';

import { $network } from '../../../common/coreRef.ts';
import { tailscaleKey } from '../../../common/tailscaleKey.ts';
import { AMI_UBUNTU_ARM64 } from '../../../constants/internal.ts';
import {
  cloudInitYaml,
  hostnameCommands,
  tailscaleInstallCommands,
  tailscaleUpCommands,
  caddyUserCommands,
  emergencySshKeyCommands,
} from '../../../common/cloudInit.ts';

import {
  instances,
  domainBase,
  namePrefix,
  hardDelete,
  tailscaleTags,
  normalizedStack,
  patientPortalDomain,
} from './config.ts';
import { applyBackup } from './backup/aws.ts';
import { sg } from './firewall.ts';
import { applyDNS } from './dns.ts';
import { region } from '../../../common/awsAccount.ts';

const LEGACY_DISKS = [
  {
    name: 'logs',
    device: '/dev/sdl',
    size: 10,
  },
  {
    name: 'data',
    device: '/dev/sdp',
    size: 50,
  },
];

const backupResources: Output<string>[] = [];
const records: Map<string, Omit<aws.route53.RecordArgs, 'zoneId'>> = new Map();

for (const [i, inst] of instances.entries()) {
  if (inst.external) continue;

  const authKey = tailscaleKey(inst.id, {
    tags: tailscaleTags,
    expirySecs: 6 * 60 * 60, // excessive but it lets us deal with most problems eg. EIP quotas
    description: `tamanu ${normalizedStack} ${inst.id}`.substring(0, 50),
  });

  const tags: { [key: string]: Input<string> } = {
    Name: `${namePrefix}${inst.name}`,
    FQDN: inst.fqdn,
    Partitioning: inst.legacyDisk ? 'split-data-logs' : 'single-btrfs',
    TailscaleName: inst.tailscaleName,
    TamanuServerID: inst.id,
    TamanuServerName: inst.name,
    TamanuServerType: inst.id === 'central' ? 'central' : 'facility',
  };

  if (patientPortalDomain && inst.id === 'central') {
    tags.PatientPortalFQDN = patientPortalDomain;
  }

  const vm = new aws.ec2.Instance(
    inst.id,
    {
      ami: AMI_UBUNTU_ARM64[region],
      instanceType: inst.instance,
      disableApiTermination: !hardDelete,
      monitoring: true,
      rootBlockDevice: {
        volumeSize: inst.disk,
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
            cloudInitYaml([
              ...hostnameCommands(fqdn),
              ...tailscaleInstallCommands(),
              ...caddyUserCommands(),
              ...tailscaleUpCommands({ authKey: key, hostname: name, advertiseTags: tags }),
              ...emergencySshKeyCommands(),
            ]),
          ),
      ),
      tags,
    },
    {
      ignoreChanges: ['ami', 'rootBlockDevice', 'userData'],
      deleteBeforeReplace: true,
    },
  );

  backupResources.push(vm.arn);

  if (inst.legacyDisk) {
    for (const { name, size, device } of LEGACY_DISKS) {
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
        { deleteBeforeReplace: true, ignoreChanges: ['size'] },
      );

      backupResources.push(volume.arn);

      new aws.ec2.VolumeAttachment(
        `${inst.id}-${name}`,
        {
          deviceName: device,
          volumeId: volume.id,
          instanceId: vm.id,
        },
        { deleteBeforeReplace: true },
      );
    }
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

  if (patientPortalDomain && inst.id === 'central') {
    records.set('patient-portal-cname', {
      name: patientPortalDomain,
      type: aws.route53.RecordType.CNAME,
      ttl: 300,
      records: [inst.fqdn],
    });
  }
}

applyBackup(backupResources);
applyDNS(records);

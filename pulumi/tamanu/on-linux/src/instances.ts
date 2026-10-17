import * as aws from '@pulumi/aws';
import { all, type Input, type Output, secret } from '@pulumi/pulumi';

import { $network } from '../../../common/coreRef.ts';
import { tailscaleKey } from '../../../common/tailscaleKey.ts';
import { TailscaleVipService } from '../../../common/tailscaleVipService.ts';
import { AMI_UBUNTU_ARM64, TAILNET_DOMAIN } from '../../../constants/internal.ts';
import {
  cloudInitYaml,
  hostnameCommands,
  tailscaleInstallCommands,
  tailscaleUpCommands,
  emergencySshKeyCommands,
} from '../../../common/cloudInit.ts';

import {
  instances,
  domainBase,
  namePrefix,
  hardDelete,
  billingTags,
  tailscaleTags,
  msupplyTailscaleTags,
  normalizedStack,
  patientPortalDomain,
  cloneOf,
} from './config.ts';
import { applyBackup } from './backup/aws.ts';
import { sg } from './firewall.ts';
import { applyDNS } from './dns.ts';
import { region } from '../../../common/awsAccount.ts';
import { alertsTopicArn } from '../../../common/coreRef.ts';
import { workloadAlertsCentralArn } from '../../../common/alertsHubRef.ts';
//import { ec2StatusAlarms } from '../../../common/ec2StatusAlarms.ts';

// spec: LNXAWS#partitioning
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

  // spec: LNXAWS#first-boot
  const authKey = tailscaleKey(inst.id, {
    tags: tailscaleTags,
    expirySecs: 6 * 60 * 60, // excessive but it lets us deal with most problems eg. EIP quotas
    description: `tamanu ${normalizedStack} ${inst.id}`.substring(0, 50),
  });

  // spec: LNXAWS#instance-tags
  const tags: { [key: string]: Input<string> } = {
    Name: `${namePrefix}${inst.name}`,
    FQDN: inst.fqdn,
    Partitioning: inst.legacyDisk ? 'split-data-logs' : 'single-btrfs',
    TailscaleName: inst.tailscaleName,
    TamanuServerID: inst.id,
    TamanuServerName: inst.name,
    TamanuServerType: inst.id === 'central' ? 'central' : 'facility',
    Purpose: 'tamanu-server',
    ManagedBy: 'pulumi',
    ...billingTags,
  };

  if (cloneOf) {
    // spec: LNXAWS#instance-tags
    tags.TamanuCloneOf = cloneOf;
  }

  if (patientPortalDomain && inst.id === 'central') {
    tags.PatientPortalFQDN = patientPortalDomain;
  }

  if (inst.msupplyFqdn) {
    // spec: LNXMSP#provisioning
    tags.MsupplyFQDN = inst.msupplyFqdn;
  }

  if (inst.msupplyTailscaleService) {
    // spec: LNXMSP#provisioning
    tags.MsupplyTailscaleService = inst.msupplyTailscaleService;
  }

  const vm = new aws.ec2.Instance(
    inst.id,
    {
      ami: AMI_UBUNTU_ARM64[region],
      instanceType: inst.instance,
      // spec: LNXAWS#provisioning
      disableApiTermination: !hardDelete,
      monitoring: true,
      rootBlockDevice: {
        volumeSize: inst.disk,
        volumeType: 'gp3',
        encrypted: true,
      },
      // spec: LNXAWS#provisioning
      metadataOptions: {
        httpTokens: 'required', // IMDSv2
        httpProtocolIpv6: 'enabled',
        instanceMetadataTags: 'enabled',
      },
      subnetId: $network.publicWorkloadSubnetIds.apply((ids) => ids[i % ids.length]),
      vpcSecurityGroupIds: [sg.id],
      // spec: LNXAWS#first-boot
      userData: all([authKey.key, tailscaleTags, inst.tailscaleName, inst.fqdn]).apply(
        ([key, tags, name, fqdn]) =>
          secret(
            cloudInitYaml([
              ...hostnameCommands(fqdn),
              ...tailscaleInstallCommands(),
              ...tailscaleUpCommands({ authKey: key, hostname: name, advertiseTags: tags }),
              ...emergencySshKeyCommands(),
            ]),
          ),
      ),
      tags,
    },
    {
      // spec: LNXAWS#provisioning
      ignoreChanges: ['ami', 'rootBlockDevice', 'userData'],
      deleteBeforeReplace: true,
    },
  );

  backupResources.push(vm.arn);

  /* ec2StatusAlarms(
    inst.id,
    {
      instanceId: vm.id,
      notifyTopicArns: [alertsTopicArn, workloadAlertsCentralArn],
      tags,
    },
    { parent: vm },
  ); */ // FIXME

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
            Purpose: 'tamanu-server',
            ManagedBy: 'pulumi',
            ...billingTags,
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
      ManagedBy: 'pulumi',
      Purpose: 'tamanu-server',
      FQDN: inst.fqdn,
      ...billingTags,
    },
  });

  // spec: LNXAWS#dns-records
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
    // spec: LNXAWS#dns-records
    records.set('patient-portal-cname', {
      name: patientPortalDomain,
      type: aws.route53.RecordType.CNAME,
      ttl: 300,
      records: [inst.fqdn],
    });
  }

  if (inst.msupplyFqdn) {
    // spec: LNXMSP#provisioning
    records.set(`${inst.id}-msupply-cname`, {
      name: inst.msupplyFqdn,
      type: aws.route53.RecordType.CNAME,
      ttl: 300,
      records: [inst.fqdn],
    });
  }
}

for (const inst of instances) {
  if (!inst.external || !inst.externalIps || inst.externalIps.length === 0) continue;

  const ipv4s = inst.externalIps.filter((ip) => ip.includes('.'));
  const ipv6s = inst.externalIps.filter((ip) => ip.includes(':'));

  if (ipv4s.length > 0) {
    records.set(`${inst.id}-v4`, {
      name: inst.fqdn,
      type: aws.route53.RecordType.A,
      ttl: 300,
      records: ipv4s,
    });
  }

  if (ipv6s.length > 0) {
    records.set(`${inst.id}-v6`, {
      name: inst.fqdn,
      type: aws.route53.RecordType.AAAA,
      ttl: 300,
      records: ipv6s,
    });
  }

  if (patientPortalDomain && inst.id === 'central') {
    records.set('patient-portal-cname', {
      name: patientPortalDomain,
      type: aws.route53.RecordType.CNAME,
      ttl: 300,
      records: [inst.fqdn],
    });
  }

  if (inst.msupplyFqdn) {
    // spec: LNXMSP#provisioning
    records.set(`${inst.id}-msupply-cname`, {
      name: inst.msupplyFqdn,
      type: aws.route53.RecordType.CNAME,
      ttl: 300,
      records: [inst.fqdn],
    });
  }
}

for (const inst of instances) {
  if (!inst.msupply || !inst.msupplyTailscaleService) continue;

  new TailscaleVipService(`${inst.id}-msupply`, {
    name: inst.msupplyTailscaleService,
    ports: ['tcp:80', 'tcp:443'],
    tags: msupplyTailscaleTags,
    comment: `mSupply on ${normalizedStack} ${inst.id}`,
  });
}

applyBackup(backupResources);
applyDNS(records);

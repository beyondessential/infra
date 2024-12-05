import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import {
  normalizedStack,
  domainBase,
  domains,
  instances,
  zoneId,
  namePrefix,
  hardDelete,
  sshKey,
} from './config.js';
import { $network, failIfIncorrectAccount } from '../../common/coreRef.js';
import * as securityGroupRules from '../../common/securityGroupRules.js';
import { all, getStack, interpolate, Output } from '@pulumi/pulumi';
import { accountId } from '../../common/awsAccount.js';
import { AWS_BACKUP_DEFAULT_SERVICE_ROLE } from '../../constants/external.js';
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

const vault = new awsNative.backup.BackupVault(
  'backup',
  {
    backupVaultName: interpolate`tamanu-on-linux-${getStack()}`,
    backupVaultTags: {
      Purpose: 'Backup',
      Name: getStack(),
    },
  },
  { parent: this },
);

const backup = new awsNative.backup.BackupPlan(
  'backup-180days',
  {
    backupPlan: {
      backupPlanName: interpolate`tamanu-on-linux-${getStack()}-180days`,
      backupPlanRule: [
        {
          ruleName: 'daily-keep8days',
          targetBackupVault: vault.backupVaultName,
          scheduleExpression: 'cron(30 0 ? * * *)',
          lifecycle: {
            deleteAfterDays: 8,
          },
        },
        {
          ruleName: 'weekly-keep8weeks',
          targetBackupVault: vault.backupVaultName,
          scheduleExpression: 'cron(0 12 ? * 7 *)',
          lifecycle: {
            deleteAfterDays: 64,
          },
        },
        {
          ruleName: 'monthly-warm1month-cold6months',
          targetBackupVault: vault.backupVaultName,
          scheduleExpression: 'cron(0 0 1 * ? *)',
          lifecycle: {
            deleteAfterDays: 180,
            moveToColdStorageAfterDays: 32,
            optInToArchiveForSupportedResources: true,
          },
        },
      ],
    },
    backupPlanTags: {
      Purpose: 'Backup',
      Name: getStack(),
    },
  },
  { parent: this },
);

// https://cloud-images.ubuntu.com/locator/ec2/
const UBUNTU_24_04_LTS_ARM64_SYDNEY = 'ami-09b56d1f2bd9893f7';

const DEVICE_NAMES = {
  root: '/dev/root',
  logs: '/dev/sdl',
  data: '/dev/sdp', // p for postgres
};

const backupResources: Output<string>[] = [];

for (const [i, inst] of instances.entries()) {
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
      keyName: sshKey,
      tags: {
        Name: `${namePrefix}${inst.name}`,
      },
    },
    {
      ignoreChanges: ['ami', 'rootBlockDevice'],
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

  new aws.route53.Record(`${inst.id}-v4`, {
    zoneId: zoneId,
    name: domains[inst.name],
    type: aws.route53.RecordType.A,
    ttl: 300,
    records: [ip.publicIp],
  });

  vm.ipv6Addresses.length &&
    new aws.route53.Record(`${inst.id}-v6`, {
      zoneId: zoneId,
      name: domains[inst.name],
      type: aws.route53.RecordType.AAAA,
      ttl: 300,
      records: [vm.ipv6Addresses[0]],
    });
}

all(backupResources).apply(
  (resources) =>
    new awsNative.backup.BackupSelection(
      'backup-resources',
      {
        backupPlanId: backup.backupPlanId,
        backupSelection: {
          selectionName: interpolate`tamanu-on-linux-${getStack()}`,
          iamRoleArn: interpolate`arn:aws:iam::${accountId}:${AWS_BACKUP_DEFAULT_SERVICE_ROLE}`,
          resources,
        },
      },
      { parent: backup },
    ),
);

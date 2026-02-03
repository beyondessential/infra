import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { all, getStack, type Input, interpolate, type Output } from '@pulumi/pulumi';

export function applyBackup(resources: Input<string>[]) {
  all(resources).apply((resolvedResources) => {
    if (resolvedResources.length === 0) {
      return;
    }

    const backupRole = new aws.iam.Role('backup-service-role', {
      namePrefix: `${getStack()}-backup-`,
      path: '/service-role/',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'backup.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      }),
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup',
        'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores',
      ],
      tags: {
        Purpose: 'tamanu-backups',
        ManagedBy: 'pulumi',
      },
    });

    const vault = new awsNative.backup.BackupVault('backup', {
      backupVaultName: interpolate`tamanu-on-linux-${getStack()}`,
      backupVaultTags: {
        Purpose: 'tamanu-backups',
        ManagedBy: 'pulumi',
        Name: getStack(),
      },
    });

    const backup = new awsNative.backup.BackupPlan('backup-180days', {
      backupPlan: {
        backupPlanName: interpolate`tamanu-on-linux-${getStack()}-12months`,
        backupPlanRule: [
          {
            ruleName: 'daily-keep7days',
            targetBackupVault: vault.backupVaultName,
            scheduleExpression: 'cron(30 0 ? * * *)',
            lifecycle: {
              deleteAfterDays: 7,
            },
          },
          {
            ruleName: 'weekly-keep4weeks',
            targetBackupVault: vault.backupVaultName,
            scheduleExpression: 'cron(0 12 ? * 7 *)',
            lifecycle: {
              deleteAfterDays: 28,
            },
          },
          {
            ruleName: 'monthly-cold12months',
            targetBackupVault: vault.backupVaultName,
            scheduleExpression: 'cron(0 0 1 * ? *)',
            lifecycle: {
              deleteAfterDays: 365,
              moveToColdStorageAfterDays: 1,
              optInToArchiveForSupportedResources: true,
            },
          },
        ],
      },
      backupPlanTags: {
        Purpose: 'tamanu-backups',
        ManagedBy: 'pulumi',
        Name: getStack(),
      },
    });

    new awsNative.backup.BackupSelection(
      'backup-resources',
      {
        backupPlanId: backup.backupPlanId,
        backupSelection: {
          selectionName: interpolate`tamanu-on-linux-${getStack()}`,
          iamRoleArn: backupRole.arn,
          resources: resolvedResources,
        },
      },
      { parent: backup },
    );
  });
}

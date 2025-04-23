import * as awsNative from '@pulumi/aws-native';
import { all, getStack, Input, interpolate } from '@pulumi/pulumi';
import { accountId } from '../../../common/awsAccount.js';
import { AWS_BACKUP_DEFAULT_SERVICE_ROLE } from '../../../constants/external.js';

const vault = new awsNative.backup.BackupVault('backup', {
  backupVaultName: interpolate`tamanu-on-linux-${getStack()}`,
  backupVaultTags: {
    Purpose: 'Backup',
    Name: getStack(),
  },
});

const backup = new awsNative.backup.BackupPlan('backup-180days', {
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
});

export function applyBackup(resources: Input<string>[]) {
  all(resources).apply(
    (resources) =>
      resources.length > 0 &&
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
}

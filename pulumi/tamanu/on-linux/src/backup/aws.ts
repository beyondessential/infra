import * as aws from '@pulumi/aws';
import * as awsNative from '@pulumi/aws-native';
import { getStack, interpolate, type Output } from '@pulumi/pulumi';
import { billingTags } from '../config.ts';

// Tag that external (not-provisioned-here) in-account EC2 resources can carry
// to opt into this stack's backup plan. Used by the tag-based selection below.
// On-prem servers can't be reached by AWS Backup and are covered separately.
export const BACKUP_OPT_IN_TAG = 'TamanuBackup';

// `resources` are the ARNs of instances/volumes provisioned by this stack.
// May be empty (e.g. an all-external stack): the plan is still created so that
// tag-opted-in external EC2 resources are backed up.
export function applyBackup(resources: Output<string>[]) {
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
      ...billingTags,
    },
  });

  const vault = new awsNative.backup.BackupVault(
    'backup',
    {
      backupVaultName: interpolate`tamanu-on-linux-${getStack()}`,
      backupVaultTags: {
        Purpose: 'tamanu-backups',
        ManagedBy: 'pulumi',
        Name: getStack(),
        ...billingTags,
      },
    },
    { ignoreChanges: ['backupVaultName'] },
  );

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
      ...billingTags,
    },
  });

  // Deterministic selection of the resources this stack provisions. Only
  // created when there are any — an empty `resources` selection is invalid.
  if (resources.length > 0) {
    new awsNative.backup.BackupSelection(
      'backup-resources',
      {
        backupPlanId: backup.backupPlanId,
        backupSelection: {
          selectionName: interpolate`tamanu-on-linux-${getStack()}`,
          iamRoleArn: backupRole.arn,
          resources,
        },
      },
      { parent: backup },
    );
  }

  // Tag-based selection: any in-account EC2 instance/EBS volume tagged
  // `TamanuBackup=<stack>` is included, even if provisioned outside this stack
  // (e.g. Windows facility servers). On-prem hosts simply never carry the tag
  // and remain on the separate backup strategy.
  new awsNative.backup.BackupSelection(
    'backup-tagged',
    {
      backupPlanId: backup.backupPlanId,
      backupSelection: {
        selectionName: interpolate`tamanu-on-linux-${getStack()}-tagged`,
        iamRoleArn: backupRole.arn,
        listOfTags: [
          {
            conditionType: 'STRINGEQUALS',
            conditionKey: BACKUP_OPT_IN_TAG,
            conditionValue: getStack(),
          },
        ],
      },
    },
    { parent: backup },
  );
}

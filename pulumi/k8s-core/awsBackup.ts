import * as awsClassic from '@pulumi/aws';
import { interpolate } from '@pulumi/pulumi';
import { AWS_EKS } from '../constants/external.ts';
import { stackName, tags as coreTags } from '../common/coreRef.ts';
import { cluster } from './cluster.ts';

const tags = {
  ...coreTags,
  Purpose: 'Backups',
  Cluster: stackName,
};

const vault = new awsClassic.backup.Vault('eks-backup-vault', {
  name: interpolate`bes-k8s-${stackName}-eks`,
  tags,
});

const backupRole = new awsClassic.iam.Role('eks-backup-role', {
  namePrefix: `EKSBackup${stackName}-`,
  description: interpolate`Role for AWS Backup of EKS cluster ${stackName}`,
  assumeRolePolicy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'backup.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  },
  managedPolicyArns: [
    'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup',
    'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores',
  ],
  tags,
});

const plan = new awsClassic.backup.Plan('eks-backup-plan', {
  name: interpolate`bes-k8s-${stackName}-eks`,
  rules: [
    {
      ruleName: 'daily',
      targetVaultName: vault.name,
      schedule: 'cron(0 14 * * ? *)',
      startWindow: 60,
      completionWindow: 180,
      lifecycle: {
        deleteAfter: 7,
      },
    },
  ],
  tags,
});

new awsClassic.backup.Selection('eks-backup-selection', {
  name: 'eks-cluster',
  planId: plan.id,
  iamRoleArn: backupRole.arn,
  resources: [cluster.arn],
});

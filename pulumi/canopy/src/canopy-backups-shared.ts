import type { Input } from '@pulumi/pulumi';

import { cfg } from '../../common/k8s/coreRef.ts';
import { CrossStack } from '../../common/CrossStack.ts';

type Env = { name: string; value: Input<string> }[];

// Roles for Canopy-provisioned shared backup buckets (deployments with no BYO AWS
// account; see pulumi/backups-shared). Gated on the backups-shared stack ref: the
// backups pod assumes the provisioner role (create bucket + apply recipe) and the
// maintenance role (GC); the public-server (the device-credential issuer) assumes
// the device role to mint per-group write-without-delete creds. Apply the
// backups-shared stack before setting this ref — the env reads its outputs.
const sharedBackupsRef = cfg.get('backupsShared');
const sharedBackups = sharedBackupsRef ? new CrossStack(sharedBackupsRef) : undefined;

// backups pod (canopy-jobs): the full shared-backup config.
export const sharedBackupsJobsEnv: Env = sharedBackups
  ? [
      {
        name: 'CANOPY_SHARED_BACKUP_PROVISIONER_ROLE_ARN',
        value: sharedBackups.get<string>('provisionerRoleArn'),
      },
      {
        name: 'CANOPY_SHARED_BACKUP_MAINTENANCE_ROLE_ARN',
        value: sharedBackups.get<string>('maintenanceRoleArn'),
      },
      {
        name: 'CANOPY_SHARED_BACKUP_DEVICE_ROLE_ARN',
        value: sharedBackups.get<string>('deviceRoleArn'),
      },
      { name: 'CANOPY_SHARED_BACKUP_REGION', value: sharedBackups.get<string>('backupRegion') },
    ]
  : [];

// public-server (canopy-issuer): device-credential minting.
export const sharedBackupsServerEnv: Env = sharedBackups
  ? [
      {
        name: 'CANOPY_SHARED_BACKUP_DEVICE_ROLE_ARN',
        value: sharedBackups.get<string>('deviceRoleArn'),
      },
      { name: 'CANOPY_SHARED_BACKUP_REGION', value: sharedBackups.get<string>('backupRegion') },
    ]
  : [];

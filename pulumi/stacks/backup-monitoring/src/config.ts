import { Config } from '@pulumi/pulumi';
import { AWS_ORG_ID } from '../../constants/internal.ts';

const config = new Config();

export const monitoringEmail = config.get('monitoringEmail') ?? 'felix@bes.au';

// Accounts that have eu-central-2 region enabled
// Add account IDs here as needed
export const euCentral2Accounts = config.getObject<string[]>('euCentral2Accounts') ?? [];

export const tags = {
  Purpose: 'backup-monitoring',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};

export { AWS_ORG_ID };

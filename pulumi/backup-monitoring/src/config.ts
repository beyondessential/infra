import { Config } from '@pulumi/pulumi';

const config = new Config();

export const monitoringEmail = config.get('monitoringEmail') ?? 'felix@bes.au';

export const euCentral2Accounts = config.getObject<string[]>('euCentral2Accounts') ?? [];

export const tags = {
  Purpose: 'backup-monitoring',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};

import { Config } from '@pulumi/pulumi';
import { AWS_ORG_ID } from '../../constants/internal.ts';

const config = new Config();

export const monitoringEmail = config.get('monitoringEmail') ?? 'felix@bes.au';

export const tags = {
  Purpose: 'backup-monitoring',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};

export { AWS_ORG_ID };

import { runPostgres } from '../../common/k8s/postgres.ts';
import { backups } from '../../common/k8s/coreRef.ts';
import { namespace } from './namespace.ts';
import { backupRetentionDays, dbReplicas, dbStorage, normalizedStack } from './config.ts';

export const dbReady = runPostgres({
  namespace,
  name: 'pollen',
  replicas: dbReplicas,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  // Volume snapshots stay until Barman has a verified backup behind it, then
  // this goes: it recovers only to the weekly snapshot instant, and CNPG has no
  // retention for it.
  backupSchedule: true,
  // WAL archiving plus nightly base backups to S3, which retention actually
  // applies to and which recover to a point in time rather than to Monday.
  barmanBackup: {
    bucket: backups.bucket,
    deployName: normalizedStack,
    retentionDays: backupRetentionDays,
  },
});

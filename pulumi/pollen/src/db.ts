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
  // WAL archiving plus nightly base backups to S3, which retention actually
  // applies to and which recover to a point in time rather than to Monday.
  barmanBackup: {
    bucket: backups.bucket,
    deployName: normalizedStack,
    retentionDays: backupRetentionDays,
  },
});

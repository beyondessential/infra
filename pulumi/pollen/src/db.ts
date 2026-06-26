import { runPostgres } from '../../common/k8s/postgres.ts';
import { namespace } from './namespace.ts';
import { dbReplicas, dbStorage } from './config.ts';

export const dbReady = runPostgres({
  namespace,
  name: 'pollen',
  replicas: dbReplicas,
  storage: dbStorage,
  timezone: 'Etc/UTC',
  backupSchedule: true,
});

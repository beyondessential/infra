import { runPostgres } from '../../common/k8s/postgres.ts';
import { costLabels } from './config.ts';
import { namespace } from './namespace.ts';

export const dbReady = runPostgres({
  namespace,
  name: 'tinker',
  replicas: 1,
  storage: '5Gi',
  timezone: 'Etc/UTC',
  inheritedMetadataLabels: costLabels,
});

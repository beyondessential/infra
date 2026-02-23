import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../../common/k8s/coreRef.ts';

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63 - 'tamanu-replica-'.length) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

export const bucket = cfg.require('bucket');
export const bucketRegion = cfg.get('bucketRegion') ?? 'ap-southeast-2';
export const repositoryPassword = cfg.requireSecret('repositoryPassword');
export const snapshotFilter: SnapshotFilter = cfg.requireObject('snapshotFilter');
export const persistentSchemas: string[] = cfg.getObject('persistentSchemas') ?? ['dbt'];
export const storageSizeMaximum = `${cfg.getNumber('storageSizeMaximumGB') ?? 200}Gi`;
export const minimumTtl = cfg.get('minimumTtl') ?? '2h';

// every 3 hours, at an arbitrary but stable amount of minutes past the hour
export const schedule = cfg.get('schedule') ?? 'H */3 * * *';

// TODO: replace with OIDC from the cluster identity
export const accessKeyId = cfg.require('accessKeyId');
export const secretAccessKey = cfg.requireSecret('secretAccessKey');

/*
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tags` | `map[string]string` | No | Key-value tags that the snapshot must match. |
| `hostPattern` | `string` | No | Glob pattern for filtering snapshot hosts. |
| `descriptionPattern` | `string` | No | Glob pattern for filtering snapshot descriptions. |
*/
export interface SnapshotFilter {
  tags?: Record<string, string>;
  hostPattern?: string;
  descriptionPattern?: string;
}

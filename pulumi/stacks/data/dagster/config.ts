import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/k8s/coreRef.ts';

export const normalizedStack = getStack()
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63 - 'dagster-'.length) // 63 is the max length of a k8s namespace, minus the prefix tamanu-
  .replace(/^-+|-+$/g, '');

export const name = ['dagster', cfg.get('namespace') ?? normalizedStack].join('-');
if (name === 'dagster-system' || name === 'dagster-super') {
  throw new Error(`Namespace name ${name.replace(/^dagster-/, '')} is reserved`);
}

export const dagsterVersion = cfg.get('dagsterVersion') ?? 'latest';
export const HOME = '/opt/dagster/dagster_home';

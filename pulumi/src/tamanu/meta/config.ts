import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/k8s/coreRef.js';
import { Architecture } from '../../common/k8s/affinities.js';
import { truncateDomainIfNeeded } from '../../common/dns.js';

export const normalizedStack = `tamanu-meta-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

export const domain =
  cfg.get('domain') ??
  truncateDomainIfNeeded(normalizedStack.replace(/^tamanu-/, ''), 'internal.tamanu.io');

export const dbStorage = cfg.get('dbStorage') ?? '5Gi';
export const replicas = cfg.getNumber('replicas') ?? 1;

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

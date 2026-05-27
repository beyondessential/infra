import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../../common/k8s/coreRef.ts';
import type { Architecture } from '../../../common/k8s/affinities.ts';
import { truncateDomainIfNeeded } from '../../../common/dns.ts';

export const normalizedStack = `dhis2-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

export const domains: string[] = cfg.getObject('domains') ?? [
  truncateDomainIfNeeded(normalizedStack.replace(/^dhis2-/, ''), 'dhis2.cd.tamanu.app'),
];

export const dbStorage = cfg.get('dbStorage') ?? '10Gi';
export const replicas = cfg.getNumber('replicas') ?? 1;

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const dbExpose = cfg.getBoolean('dbExpose') ?? false;

export const deployment = cfg.get('deployment') ?? 'dhis2';
export const stage = cfg.get('stage') ?? 'prod';
export const costLabels = { product: 'senaite', stage, deployment } as const;

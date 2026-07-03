import { getStack } from '@pulumi/pulumi';
import { cfg } from '../../common/k8s/coreRef.ts';
import type { Architecture } from '../../common/k8s/affinities.ts';

export const normalizedStack = `tailzero-${getStack()}`
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+$/, '')
  .slice(0, 63) // 63 is the max length of a k8s namespace
  .replace(/^-+|-+$/g, '');

export const border0InviteCode = cfg.requireSecret('border0InviteCode');

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/borderzero/tailzero:${imageTag}`;

export const architecture: Architecture = cfg.get('architecture') ?? 'arm64';
if (!['amd64', 'arm64'].includes(architecture)) {
  throw new Error(`Invalid architecture: ${architecture}`);
}

export const storageSize = cfg.get('storageSize') ?? '1Gi';
export const storageClassName = cfg.get('storageClassName') ?? 'ebs-gp3';

export const cpuRequest = cfg.get('cpuRequest') ?? '10m';
export const memoryRequest = cfg.get('memoryRequest') ?? '128Mi';
export const cpuLimit = cfg.get('cpuLimit');
export const memoryLimit = cfg.get('memoryLimit');

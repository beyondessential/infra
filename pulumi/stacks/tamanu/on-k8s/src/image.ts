import { cfg } from '../../../common/k8s/coreRef.ts';

export type ImageType = 'central' | 'facility' | 'frontend' | 'patient-portal';

export const imageTag = cfg.require('imageTag');
export function image(name: ImageType): string {
  return `ghcr.io/beyondessential/tamanu-${name}:${imageTag}`;
}

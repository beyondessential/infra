import { cfg } from '../../common/coreRef.js';

export type ImageType = 'central' | 'facility' | 'frontend';

export const imageTag = cfg.require('imageTag');
export function image(name: ImageType): string {
  return `ghcr.io/beyondessential/tamanu-${name}:${imageTag}`;
}

import { cfg } from '../../common/k8s/coreRef.js';

export type ImageType = 'central' | 'facility' | 'frontend';

export const imageTag = cfg.require('imageTag');
export function image(name: ImageType): string {
  return `143295493206.dkr.ecr.ap-southeast-2.amazonaws.com/tamanu/${name}:${imageTag}`;
}

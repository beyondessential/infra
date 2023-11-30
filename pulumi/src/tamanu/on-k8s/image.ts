import { cfg } from '../../common/k8s/coreRef.js';

export const imageTag = cfg.require('imageTag');
export function image(name: 'central' | 'facility'): string {
  return `143295493206.dkr.ecr.ap-southeast-2.amazonaws.com/tamanu/${name}:${imageTag}`;
}

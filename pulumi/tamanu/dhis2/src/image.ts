import { cfg } from '../../../common/k8s/coreRef.ts';

export const imageTag = cfg.require('imageTag');
export function image(): string {
  return `dhis2/core:${imageTag}`;
}

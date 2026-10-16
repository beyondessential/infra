import { cfg } from '../../common/k8s/coreRef.ts';

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/passcod/first-officer:${imageTag}`;

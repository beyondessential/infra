import { cfg } from '../../../common/k8s/coreRef.ts';

export const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/beyondessential/postgres-restore-operator:${imageTag}`;
export const maxConcurrentRestores = cfg.getNumber('maxConcurrentRestores') ?? 2;

import { cfg } from '../../common/k8s/coreRef.ts';

const imageTag = cfg.require('imageTag');
export const image = `ghcr.io/ericc-ch/copilot-api:${imageTag}`;

export const ghToken = cfg.requireSecret('ghToken');
export const port = cfg.getNumber('port') ?? 4141;

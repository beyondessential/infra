import { cfg } from '../cfg.ts';

// Where Argo CD runs, for every stack that installs it or hands work to it.
// Each stack reads it from its own `argoNamespace` config, so setting it in one
// means setting it in all.
export const argoNamespace = cfg.get('argoNamespace') ?? 'argocd-system';

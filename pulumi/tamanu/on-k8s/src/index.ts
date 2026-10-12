import { cfg } from '../../../common/cfg.ts';

// `pulumi` applies every Kubernetes object from this program. `argo` creates a
// small stub and hands the deployment to Argo CD, which renders it with
// tamanu-render. Both read the same stack config.
const deployer = cfg.get('deployer') ?? 'pulumi';
if (deployer !== 'pulumi' && deployer !== 'argo') {
  throw new Error(`Invalid deployer: ${deployer}`);
}

// Loaded dynamically: the modules create resources as they are evaluated, so
// only the chosen path may be imported.
const program = deployer === 'argo' ? await import('./argo/index.ts') : await import('./legacy.ts');

export const urls = program.urls;

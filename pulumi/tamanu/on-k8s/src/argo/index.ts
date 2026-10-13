import { failIfIncorrectCluster } from '../../../../common/k8s/coreRef.ts';
import { domains } from '../config.ts';
import { namespace } from '../namespace.ts';
import { setupTtlHibernation } from '../schedule.ts';
import { application, waitForHealthy } from './application.ts';
import { renderParams } from './params.ts';

await failIfIncorrectCluster();

// The stub creates what cannot be rendered: secret values, and anything that
// needs the live cluster or the clock. Everything else is rendered by
// infra-argo-tamanu-renderer and applied by Argo CD. These modules create resources as they
// are evaluated, so they are loaded only after the cluster check.
await import('../secrets.ts');
await import('../common/crypto.ts');
await import('./secrets.ts');

setupTtlHibernation(namespace);

const app = application(renderParams());

// Resolves once Argo has synced the deployment and it is healthy, and fails the
// update otherwise, as a failed migration does for the program Argo replaces.
export const argoApplication = waitForHealthy(app);

export const urls = Object.fromEntries(
  Object.entries(domains).map(([key, value]) => [
    `${key[0].toUpperCase()}${key.slice(1).replace(/(\d)/, ' $1')}`,
    `https://${value}`,
  ]),
);

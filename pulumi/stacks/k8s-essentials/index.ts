import { failIfIncorrectCluster, cfg } from '../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './gatewayApi.ts';
import './ingress.ts';
import './metrics/prometheus.ts';
import './metrics/opencost.ts';
import './metrics/roles.ts';
//import './metrics/grafana.ts';
import './postgres.ts';
import './tailscale.ts';
import './roles/index.ts';

if (cfg.getBoolean('hncEnabled') !== false) {
  await import('./hnc/crds.ts');
  await import('./hnc/roles.ts');
  await import('./hnc/manager.ts');
  await import('./hnc/webhooks.ts');
}

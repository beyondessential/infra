import { failIfIncorrectCluster, cfg } from '../common/k8s/coreRef.ts';
await failIfIncorrectCluster();
// When bootstrapping a new cluster, you need to deploy k8s-essentials
// without the tailscale proxy being up. First call:
//
// $ aws-sso exec -p <profile> -- aws eks update-kubeconfig --name <cluster-name>
//
// Then edit ~/.kube/config and:
// - change user.exec.command to `aws-sso`
// - prepend to user.exec.args:
//   - exec
//   - -p
//   - <profile>
//   - "--"
//   - aws
//
// Then test the connection with:
// $ kubectl --cluster=<cluster-name> cluster-info
//
// Finally, set the context for pulumi:
// $ pulumi config set kubernetes:cluster <cluster-name>
//
// Then do the bring up. Once the tailscale proxy is up, install its kubeconfig and change
// the config to its cluster, so you can run further updates via the tailscale connection,
// and reset the default context/cluster in the kubeconfig.
//
// During bootstrap, you'll also want to go to postgres.ts and comment out the catalogs,
// until the CNPG resource definitions are installed.

import './gatewayApi.ts';

import './metrics/prometheus.ts';
import './metrics/opencost.ts';
import './metrics/roles.ts';
//import './metrics/grafana.ts';

import './postgres.ts';

import './tailscale.ts';

import './roles/index.ts';

if (cfg.getBoolean('nginxEnabled') ?? true) {
  await import('./ingress.ts');
}

if (cfg.getBoolean('hncEnabled') ?? true) {
  await import('./hnc/crds.ts');
  await import('./hnc/roles.ts');
  await import('./hnc/manager.ts');
  await import('./hnc/webhooks.ts');
}

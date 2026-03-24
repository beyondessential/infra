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
// Then do the bring up. Once the tailscale proxy is up, add it to the kubeconfig and change
// the current context, see https://devinthewild.com/article/how-to-switch-between-kubernetes-clusters-in-kubectl
// You can run further updates via the tailscale connection.
//
// During bootstrap, you'll also want to go to postgres/cnpg.ts and comment out the catalogs,
// until the CNPG resource definitions are installed.

if (cfg.getBoolean('envoyGatewayEnabled') ?? false) {
  await import('./envoyGateway.ts');
}

import './metrics/prometheus.ts';
import './metrics/opencost.ts';
import './metrics/roles.ts';

import './tailscale.ts';

import './roles/index.ts';

if (cfg.getBoolean('nginxEnabled') ?? true) {
  await import('./ingress.ts');
}

if (cfg.getBoolean('postgresEnabled') ?? true) {
  await import('./postgres/cnpg.ts');
}

if (cfg.getBoolean('postgresRestoreEnabled') ?? false) {
  // you must apply the CRDs separately, Pulumi barfs on them
  await import('./postgres/restore/index.ts');
}

if (cfg.getBoolean('tinkerEnabled') ?? false) {
  await import('./tinker/index.ts');
}

if (cfg.getBoolean('hncEnabled') ?? true) {
  await import('./hnc/crds.ts');
  await import('./hnc/roles.ts');
  await import('./hnc/manager.ts');
  await import('./hnc/webhooks.ts');
}

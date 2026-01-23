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
// $ kubectl --context=<context-name> cluster-info
//
// Finally, set the context for pulumi:
// $ pulumi config set kubernetes:context <context-name>
//
// Then do the bring up. Once the tailscale proxy is up, remove the context config,
// and then you can run further updates to k8s-essentials via the tailscale connection.

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

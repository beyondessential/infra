import { failIfIncorrectCluster } from '../common/k8s/coreRef.ts';
await failIfIncorrectCluster();

import './gatewayApi.ts';
import './ingress.ts';
import './metrics/prometheus.ts';
//import './metrics/grafana.ts';
import './postgres.ts';
import './tailscale.ts';

import './hnc/crds.ts';
import './hnc/roles.ts';
import './hnc/manager.ts';
import './hnc/webhooks.ts';

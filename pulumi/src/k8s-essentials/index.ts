import { failIfIncorrectCluster } from '../common/k8s/coreRef.js';
await failIfIncorrectCluster();

import './gatewayApi.js';
import './ingress.js';
import './metrics/prometheus.js';
import './metrics/grafana.js';
import './postgres.js';
import './tailscale.js';
import './redis.js';

import './hnc/crds.js';
import './hnc/roles.js';
import './hnc/manager.js';
import './hnc/webhooks.js';

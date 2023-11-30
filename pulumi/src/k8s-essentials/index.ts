import { failIfIncorrectCluster } from '../common/k8sCoreRef.js';
await failIfIncorrectCluster();

import './certManager.js';
import './gatewayApi.js';
import './metrics/prometheus.js';
import './metrics/grafana.js';
import './postgres.js';

import * as k8s from '@pulumi/kubernetes';
import { namespace } from './namespace.ts';
import { METRICS_SERVER_VERSION } from '../versions.ts';

// Serves the `metrics.k8s.io` API, which `kubectl top` and horizontal autoscalers read.
// EKS ships only its own `metrics.eks.amazonaws.com` extension API, and Prometheus does not
// provide this one.
new k8s.helm.v3.Release('metrics-server', {
  name: 'metrics-server',
  chart: 'metrics-server',
  version: METRICS_SERVER_VERSION,
  repositoryOpts: {
    repo: 'https://kubernetes-sigs.github.io/metrics-server',
  },
  namespace,
  values: {
    // One replica is enough: it holds only the latest scrape in memory, and a gap while it
    // restarts costs nothing but a failed `kubectl top`.
    replicas: 1,
    resources: {
      requests: {
        cpu: '50m',
        memory: '128Mi',
      },
      limits: {
        memory: '256Mi',
      },
    },
  },
});

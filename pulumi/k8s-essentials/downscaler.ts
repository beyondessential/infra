import * as k8s from '@pulumi/kubernetes';
import { KUBE_DOWNSCALER_VERSION } from './versions.ts';

// py-kube-downscaler scales workloads down outside of configured uptime
// windows. It does nothing on its own — workloads opt in via the
// `downscaler/uptime` (or `downscaler/exclude`) annotation, set on either the
// resource itself or its namespace.
//
// We run with the default policy of "always up unless annotated", so untagged
// namespaces are unaffected.

// spec: TSD#cluster-downscaler
const namespace = new k8s.core.v1.Namespace('kube-downscaler', {
  metadata: {
    name: 'kube-downscaler',
  },
});

new k8s.helm.v3.Release(
  'py-kube-downscaler',
  {
    name: 'py-kube-downscaler',
    chart: 'py-kube-downscaler',
    version: KUBE_DOWNSCALER_VERSION,
    repositoryOpts: {
      repo: 'https://caas-team.github.io/helm-charts/',
    },
    namespace: namespace.metadata.name,
    values: {
      arguments: [
        '--interval=60',
        '--include-resources=deployments,statefulsets,horizontalpodautoscalers,cronjobs',
      ],
      resources: {
        requests: {
          cpu: '10m',
          memory: '64Mi',
        },
        limits: {
          memory: '256Mi',
        },
      },
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: 'bes.node.purpose', operator: 'In', values: ['system'] },
                ],
              },
            ],
          },
        },
      },
    },
  },
  {
    parent: namespace,
    deleteBeforeReplace: true,
  },
);

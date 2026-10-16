import * as k8s from '@pulumi/kubernetes';
import { provider } from '../kubeconfig.ts';
import { purposeAffinity, type Purpose } from '../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../common/k8s/tolerations.ts';
import { karpenter } from './controller.ts';

// Holds a floor of one node per `bes.node.purpose` value (system, ingress).
//
// The pattern: one low-priority Deployment pinned to each purpose, with a
// pause container. Real pods preempt the placeholder via PriorityClass, so
// it never blocks scheduling — but as long as nothing is preempting it, the
// placeholder pod is happily sat on the node and Karpenter's consolidator
// won't take that node away. If the node is disrupted anyway (spot
// interruption, drift, manual drain), the placeholder goes pending and
// Karpenter provisions a fresh node from the matching pool.
//
// Without this, every workload of a given purpose can drain to zero (e.g.
// during a redeploy) and Karpenter happily takes the underlying nodes with
// it — which is what hosed Tailscale reachability on the data cluster when
// every ingress node disappeared at once.

const PRIORITY_CLASS = 'bes-placeholder';

const priority = new k8s.scheduling.v1.PriorityClass(
  'placeholder-priority',
  {
    metadata: { name: PRIORITY_CLASS },
    value: -1000,
    globalDefault: false,
    description: 'Evictable floor-keepers for Karpenter purposes. Real workloads preempt.',
    preemptionPolicy: 'Never',
  },
  { provider },
);

const PURPOSES_WITH_FLOOR: Purpose[] = ['system', 'ingress'];

for (const purpose of PURPOSES_WITH_FLOOR) {
  new k8s.apps.v1.Deployment(
    `placeholder-${purpose}`,
    {
      metadata: {
        name: `placeholder-${purpose}`,
        namespace: 'kube-system',
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: `placeholder-${purpose}` } },
        template: {
          metadata: { labels: { app: `placeholder-${purpose}` } },
          spec: {
            priorityClassName: PRIORITY_CLASS,
            terminationGracePeriodSeconds: 0,
            // Soft spot taint — tolerate so Karpenter is free to satisfy the
            // floor with a spot node if that's all the matching pool has on
            // offer at the moment.
            tolerations: [CAN_RUN_ON_SPOT],
            affinity: {
              nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms: [
                    { matchExpressions: [purposeAffinity(purpose)] },
                  ],
                },
              },
            },
            containers: [
              {
                name: 'pause',
                image: 'registry.k8s.io/pause:3.10',
                resources: {
                  requests: { cpu: '10m', memory: '16Mi' },
                  limits: { cpu: '10m', memory: '32Mi' },
                },
              },
            ],
          },
        },
      },
    },
    { provider, dependsOn: [priority, karpenter] },
  );
}

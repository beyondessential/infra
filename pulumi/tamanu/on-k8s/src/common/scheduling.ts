import type { ComponentResource } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../../common/k8s/tolerations.ts';
import { architecture, capacity } from '../config.ts';
import { namespace } from '../namespace.ts';

const ON_DEMAND = {
  key: 'bes.node.schedule',
  operator: 'In',
  values: ['ondemand'],
};

export function workloadScheduling(
  spreadSelector?: Record<string, string>,
): Pick<k8s.types.input.core.v1.PodSpec, 'tolerations' | 'affinity' | 'topologySpreadConstraints'> {
  const required = [archAffinity(architecture), purposeAffinity('workload')];

  // Keep replicas on separate nodes so one reclaim or drain never takes them
  // all. Counting only the current ReplicaSet lets a rolling update surge onto
  // occupied nodes.
  const spread = spreadSelector
    ? {
        topologySpreadConstraints: [
          {
            maxSkew: 1,
            topologyKey: 'kubernetes.io/hostname',
            whenUnsatisfiable: 'DoNotSchedule',
            labelSelector: { matchLabels: spreadSelector },
            matchLabelKeys: ['pod-template-hash'],
          },
        ],
      }
    : {};

  if (capacity === 'ondemand') {
    return {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [{ matchExpressions: [...required, ON_DEMAND] }],
          },
        },
      },
      ...spread,
    };
  }

  return {
    tolerations: [CAN_RUN_ON_SPOT],
    affinity: {
      nodeAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 1, preference: RUN_ON_SPOT }],
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [{ matchExpressions: required }],
        },
      },
    },
    ...spread,
  };
}

// Lets a drain evict one replica at a time, so the others keep serving while
// it is rescheduled.
export function replicaDisruptionBudget(
  name: string,
  selector: Record<string, string>,
  parent: ComponentResource,
): k8s.policy.v1.PodDisruptionBudget {
  return new k8s.policy.v1.PodDisruptionBudget(
    name,
    {
      metadata: { namespace },
      spec: { maxUnavailable: 1, selector: { matchLabels: selector } },
    },
    { parent },
  );
}

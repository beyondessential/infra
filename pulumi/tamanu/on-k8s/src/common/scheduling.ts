import type * as k8s from '@pulumi/kubernetes';
import { RUN_ON_SPOT, archAffinity, purposeAffinity } from '../../../../common/k8s/affinities.ts';
import { CAN_RUN_ON_SPOT } from '../../../../common/k8s/tolerations.ts';
import { architecture, capacity } from '../config.ts';

const ON_DEMAND = {
  key: 'bes.node.schedule',
  operator: 'In',
  values: ['ondemand'],
};

export function workloadScheduling(): Pick<
  k8s.types.input.core.v1.PodSpec,
  'tolerations' | 'affinity'
> {
  const required = [archAffinity(architecture), purposeAffinity('workload')];

  if (capacity === 'ondemand') {
    return {
      affinity: {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [{ matchExpressions: [...required, ON_DEMAND] }],
          },
        },
      },
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
  };
}

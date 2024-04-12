import { Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

export interface PodSpecArgs {
  podType: string;
  command?: string[];
  podSpreadSelector?: { [key: string]: string };
  containerArgs?: Partial<k8s.types.input.core.v1.Container>;
  volumes?: Input<k8s.types.input.core.v1.Volume>[];
}

export type PodSpecFactory = (args: PodSpecArgs) => k8s.types.input.core.v1.PodSpec;

export function podSpreadAntiAffinity(podSpreadSelector?: {
  [key: string]: string;
}): k8s.types.input.core.v1.PodAntiAffinity {
  return podSpreadSelector
    ? {
        // spread out across AZs
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [
                ...Object.entries(podSpreadSelector).map(([key, value]) => ({
                  key,
                  operator: 'In',
                  values: [value],
                })),
              ],
            },
            topologyKey: 'topology.kubernetes.io/zone',

            // only apply rules within a deployment's rollout, not across all matching pods ever
            matchLabelKeys: ['pod-template-hash'],
          },
        ],
      }
    : {};
}

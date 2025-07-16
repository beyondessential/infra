import type { Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

export interface PodSpecArgs {
  podType: string;
  podSpreadSelector?: { [key: string]: string };
  command?: string[];
  containerArgs?: Partial<k8s.types.input.core.v1.Container>;
  volumes?: Input<k8s.types.input.core.v1.Volume>[];
  env?: Input<k8s.types.input.core.v1.EnvVar>[];
}

export type PodSpecFactory = (args: PodSpecArgs) => k8s.types.input.core.v1.PodSpec;

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

// One-shot jobs (migrations, provisioning) can legitimately use far more memory
// than a server at steady state, so only long-running pods get a memory limit.
const ONE_SHOT_POD_TYPES = ['migrator', 'provisioner', 'seed-top-up', 'setup-sync'];

export function appMemoryLimit(podType: string): { limits?: { memory: string } } {
  return ONE_SHOT_POD_TYPES.includes(podType) ? {} : { limits: { memory: '1Gi' } };
}

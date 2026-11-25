import type { Input } from '@pulumi/pulumi';
import type * as k8s from '@pulumi/kubernetes';

import { githubToken } from './config.ts';

// spec: K8SCNP#workloads
export const githubEnv: Input<k8s.types.input.core.v1.EnvVar>[] = githubToken
  ? [{ name: 'CANOPY_GITHUB_TOKEN', value: githubToken }]
  : [];

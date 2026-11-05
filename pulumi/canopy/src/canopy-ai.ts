import type { Input } from '@pulumi/pulumi';
import type * as k8s from '@pulumi/kubernetes';

import { ai } from './config.ts';

/**
 * How the AI worker reaches its model provider.
 *
 * Deliberately not in `spec()`: the worker is the one process that holds the
 * provider's key, and no other pod should have it, which Canopy's vulnerability
 * triage spec states as well. The model and the endpoint are not secret, but they
 * go with the key so the three are read from one place.
 *
 * Empty where no model is configured, which is also where the worker is not run.
 */
// spec: K8SCNP#workloads
export const aiEnv: Input<k8s.types.input.core.v1.EnvVar>[] = ai
  ? [
      { name: 'OPENROUTER_API_KEY', value: ai.apiKey },
      { name: 'OPENROUTER_MODEL', value: ai.model },
      ...(ai.baseUrl ? [{ name: 'OPENROUTER_BASE_URL', value: ai.baseUrl }] : []),
    ]
  : [];

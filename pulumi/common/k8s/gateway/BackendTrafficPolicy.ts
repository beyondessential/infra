import type { CustomResourceOptions, Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import { EG_API_VERSION } from './consts/API.ts';
import type { LocalPolicyTargetReference } from './interfaces/LocalPolicyTargetReference.ts';

export interface BackendTrafficPolicyArgs {
  metadata: Input<k8s.types.input.meta.v1.ObjectMeta>;
  spec: Input<BackendTrafficPolicySpec>;
}

/**
 * RequestBuffer has the gateway fully receive each request before forwarding it
 * upstream, which shields backends from slow clients and imposes a maximum
 * request size.
 */
export interface RequestBuffer {
  /**
   * Maximum size of an incoming request body, in `resource.Quantity` format
   * (e.g. `50Mi`). A request exceeding it is rejected with 413.
   *
   * The gateway's connection buffer must be sized to account for this; see
   * `ClientTrafficPolicy.spec.connection.bufferLimit`, which defaults to 32KiB.
   */
  limit: Input<string>;
}

/**
 * BackendTrafficPolicySpec covers only the fields used here. Envoy Gateway's
 * BackendTrafficPolicy has considerably more (circuit breakers, retries, load
 * balancing, health checks); add them as they are needed.
 */
export interface BackendTrafficPolicySpec {
  targetRefs: Input<Array<Input<LocalPolicyTargetReference>>>;
  requestBuffer?: Input<RequestBuffer>;
}

/**
 * BackendTrafficPolicy configures how the gateway handles traffic on its way to
 * a backend, attached to a Gateway or a Route.
 */
export function BackendTrafficPolicy(
  name: string,
  args: BackendTrafficPolicyArgs,
  opts?: CustomResourceOptions,
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    name,
    {
      ...args,
      apiVersion: EG_API_VERSION,
      kind: 'BackendTrafficPolicy',
    },
    opts,
  );
}

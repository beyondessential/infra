import type { Input } from '@pulumi/pulumi';
import type { BackendObjectReference } from './BackendObjectReference.ts';
import type { Fraction } from './Fraction.ts';

/**
 * Defines configuration for the RequestMirror filter.
 */
export interface HTTPRequestMirrorFilter {
  /**
   * BackendRef references a resource where mirrored requests are sent.
   *
   * Mirrored requests must be sent only to a single destination endpoint
   * within this BackendRef, irrespective of how many endpoints are present
   * within this BackendRef.
   *
   * If the referent cannot be found, this BackendRef is invalid and must be
   * dropped from the Gateway. The controller must ensure the `ResolvedRefs`
   * condition on the Route status is set to `status: False` and not configure
   * this backend in the underlying implementation.
   *
   * If there is a cross-namespace reference to an existing object
   * that is not allowed by a ReferenceGrant, the controller must ensure the
   * `ResolvedRefs` condition on the Route is set to `status: False`,
   * with the "RefNotPermitted" reason and not configure this backend in the
   * underlying implementation.
   *
   * In either error case, the Message of the `ResolvedRefs` Condition
   * should be used to provide more detail about the problem.
   *
   * _Support: Extended for Kubernetes Service_
   *
   * _Support: Implementation-specific for any other resource_
   */
  backendRef: Input<BackendObjectReference>;

  /**
   * Represents the percentage of requests that should be
   * mirrored to BackendRef. Its minimum value is 0 (indicating 0% of
   * requests) and its maximum value is 100 (indicating 100% of requests).
   *
   * Only one of `fraction` or `percent` may be specified. If neither field
   * is specified, 100% of requests will be mirrored.
   */
  percent?: Input<number>;

  /**
   * Represents the fraction of requests that should be
   * mirrored to BackendRef.
   *
   * Only one of `fraction` or `percent` may be specified. If neither field
   * is specified, 100% of requests will be mirrored.
   */
  fraction?: Input<Fraction>;
}

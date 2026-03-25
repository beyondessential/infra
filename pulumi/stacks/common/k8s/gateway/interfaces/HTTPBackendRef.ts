import type { Input } from '@pulumi/pulumi';
import type { HTTPRouteFilter } from './HTTPRouteFilter.ts';
import type { BackendObjectReference } from './BackendObjectReference.ts';

/**
 * Defines how a HTTPRoute forwards a HTTP request.
 *
 * Note that when a namespace different than the local namespace
 * is specified, a ReferenceGrant object is required in the referent
 * namespace to allow that namespace's owner to accept the reference.
 * See the ReferenceGrant documentation for details.
 *
 * When the BackendRef points to a Kubernetes Service, implementations SHOULD
 * honor the appProtocol field if it is set for the target Service Port.
 *
 * Implementations supporting appProtocol SHOULD recognize the Kubernetes
 * Standard Application Protocols defined in KEP-3726.
 *
 * If a Service appProtocol isn't specified, an implementation MAY infer the
 * backend protocol through its own means. Implementations MAY infer the
 * protocol from the Route type referring to the backend Service.
 *
 * If a Route is not able to send traffic to the backend using the specified
 * protocol then the backend is considered invalid. Implementations MUST set
 * the "ResolvedRefs" condition to "False" with the "UnsupportedProtocol" reason.
 */
export interface HTTPBackendRef extends BackendObjectReference {
  /**
   * Weight specifies the proportion of requests forwarded to the referenced
   * backend. This is computed as weight/(sum of all weights in this
   * BackendRefs list). For non-zero values, there may be some epsilon from
   * the exact proportion defined here depending on the precision an
   * implementation supports. Weight is not a percentage and the sum of
   * weights does not need to equal 100.
   *
   * If only one backend is specified and it has a weight greater than 0, 100%
   * of the traffic is forwarded to that backend. If weight is set to 0, no
   * traffic should be forwarded for this entry. If unspecified, weight
   * defaults to 1.
   *
   * _Support for this field varies based on the context where used._
   */
  weight?: Input<number>;

  /**
   * Filters defined at this level should be executed if and only if the
   * request is being forwarded to the backend defined here.
   *
   * _Support: Implementation-specific (For broader support of filters, use the
   * Filters field in HTTPRouteRule.)_
   */
  filters?: Input<Array<Input<HTTPRouteFilter>>>;
}

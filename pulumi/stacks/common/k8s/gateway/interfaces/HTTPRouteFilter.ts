import type { Input } from '@pulumi/pulumi';
import type * as k8s from '@pulumi/kubernetes';
import type { HTTPExternalAuthFilter } from './HTTPExternalAuthFilter.ts';
import type { HTTPCORSFilter } from './HTTPCORSFilter.ts';
import type { HTTPURLRewriteFilter } from './HTTPURLRewriteFilter.ts';
import type { HTTPRequestRedirectFilter } from './HTTPRequestRedirectFilter.ts';

/**
 * Defines processing steps that must be completed during the request
 * or response lifecycle. HTTPRouteFilters are meant as an extension point
 * to express processing that may be done in Gateway implementations. Some
 * examples include request or response modification, implementing authentication
 * strategies, rate-limiting, and traffic shaping. API guarantee/conformance
 * is defined based on the type of the filter.
 */
export interface HTTPRouteFilter {
  /**
   * Type identifies the type of filter to apply. As with other API fields,
   * types are classified into three conformance levels:
   *
   * - Core: Filter types and their corresponding configuration defined by
   *   "Support: Core" in this package, e.g. "RequestHeaderModifier". All
   *   implementations must support core filters.
   * - Extended: Filter types and their corresponding configuration defined by
   *   "Support: Extended" in this package, e.g. "RequestMirror". Implementers
   *   are encouraged to support extended filters.
   * - Implementation-specific: Filters that are defined and supported by
   *   specific vendors.
   *
   * In the future, filters showing convergence in behavior across multiple
   * implementations will be considered for inclusion in extended or core
   * conformance levels. Filter-specific configuration for such filters
   * is specified using the ExtensionRef field. Type should be set to
   * "ExtensionRef" for custom filters.
   *
   * Implementers are encouraged to define custom implementation types to
   * extend the core API with implementation-specific behavior.
   *
   * If a reference to a custom filter type cannot be resolved, the filter
   * MUST NOT be skipped. Instead, requests that would have been processed by
   * that filter MUST receive a HTTP error response.
   *
   * Note that values may be added to this enum, implementations
   * must ensure that unknown values will not cause a crash.
   *
   * Unknown values here must result in the implementation setting the
   * Accepted Condition for the Route to status: False, with a
   * Reason of UnsupportedValue.
   */
  type: Input<HTTPRouteFilterType>;

  /**
   * RequestHeaderModifier defines a schema for a filter that modifies request
   * headers.
   *
   * _Support: Core_
   */
  requestHeaderModifier?: Input<HTTPHeaderFilter>;

  /**
   * ResponseHeaderModifier defines a schema for a filter that modifies response
   * headers.
   *
   * _Support: Extended_
   */
  responseHeaderModifier?: Input<HTTPHeaderFilter>;

  /**
   * RequestMirror defines a schema for a filter that mirrors requests.
   *
   * Requests are sent to the specified destination, but responses from
   * that destination are ignored.
   *
   * This filter can be used multiple times within the same rule. Note that
   * not all implementations will be able to support mirroring to multiple
   * backends.
   *
   * _Support: Extended_
   */
  requestMirror?: Input<HTTPRequestMirrorFilter>;

  /**
   * RequestRedirect defines a schema for a filter that responds to the
   * request with an HTTP redirection.
   *
   * _Support: Core_
   */
  requestRedirect?: Input<HTTPRequestRedirectFilter>;

  /**
   * URLRewrite defines a schema for a filter that modifies a request during forwarding.
   *
   * _Support: Extended_
   */
  urlRewrite?: Input<HTTPURLRewriteFilter>;

  /**
   * CORS defines a schema for a filter that responds to the
   * cross-origin request based on HTTP response header.
   *
   * _Support: Extended_
   */
  cors?: Input<HTTPCORSFilter>;

  /**
   * ExternalAuth configures settings related to sending request details
   * to an external auth service. The external service MUST authenticate
   * the request, and MAY authorize the request as well.
   *
   * If there is any problem communicating with the external service,
   * this filter MUST fail closed.
   *
   * _Support: Extended_
   */
  externalAuth?: Input<HTTPExternalAuthFilter>;

  /**
   * ExtensionRef is an optional, implementation-specific extension to the
   * "filter" behavior. For example, resource "myroutefilter" in group
   * "networking.example.net"). ExtensionRef MUST NOT be used for core and
   * extended filters.
   *
   * This filter can be used multiple times within the same rule.
   *
   * _Support: Implementation-specific_
   */
  extensionRef?: Input<k8s.types.input.core.v1.LocalObjectReference>;
}

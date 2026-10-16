/**
 * Identifies a type of HTTPRoute filter.
 */
export const HTTPRouteFilterType = {
  /**
   * HTTPRouteFilterRequestHeaderModifier can be used to add or remove an HTTP
   * header from an HTTP request before it is sent to the upstream target.
   *
   * _Support in HTTPRouteRule: Core_
   *
   * _Support in HTTPBackendRef: Extended_
   */
  RequestHeaderModifier: 'RequestHeaderModifier',

  /**
   * HTTPRouteFilterResponseHeaderModifier can be used to add or remove an HTTP
   * header from an HTTP response before it is sent to the client.
   *
   * _Support in HTTPRouteRule: Extended_
   *
   * _Support in HTTPBackendRef: Extended_
   */
  ResponseHeaderModifier: 'ResponseHeaderModifier',

  /**
   * HTTPRouteFilterRequestRedirect can be used to redirect a request to
   * another location. This filter can also be used for HTTP to HTTPS
   * redirects. This may not be used on the same Route rule or BackendRef as a
   * URLRewrite filter.
   *
   * _Support in HTTPRouteRule: Core_
   *
   * _Support in HTTPBackendRef: Extended_
   */
  RequestRedirect: 'RequestRedirect',

  /**
   * HTTPRouteFilterURLRewrite can be used to modify a request during
   * forwarding. At most one of these filters may be used on a Route rule.
   * This may not be used on the same Route rule or BackendRef as a
   * RequestRedirect filter.
   *
   * _Support in HTTPRouteRule: Extended_
   *
   * _Support in HTTPBackendRef: Extended_
   */
  URLRewrite: 'URLRewrite',

  /**
   * HTTPRouteFilterRequestMirror can be used to mirror HTTP requests to a
   * different backend. The responses from this backend MUST be ignored by
   * the Gateway.
   *
   * _Support in HTTPRouteRule: Extended_
   *
   * _Support in HTTPBackendRef: Extended_
   */
  RequestMirror: 'RequestMirror',

  /**
   * HTTPRouteFilterCORS can be used to add CORS headers to an
   * HTTP response before it is sent to the client.
   *
   * _Support in HTTPRouteRule: Extended_
   *
   * _Support in HTTPBackendRef: Extended_
   */
  CORS: 'CORS',

  /**
   * HTTPRouteFilterExternalAuth can be used to configure a Gateway implementation
   * to call out to an external Auth server, which MUST perform Authentication
   * and MAY perform Authorization on the matched request before the request
   * is forwarded to the backend.
   *
   * _Support in HTTPRouteRule: Extended_
   *
   * _Feature Name: HTTPRouteExternalAuth_
   */
  ExternalAuth: 'ExternalAuth',

  /**
   * HTTPRouteFilterExtensionRef should be used for configuring custom
   * HTTP filters.
   *
   * _Support in HTTPRouteRule: Implementation-specific_
   *
   * _Support in HTTPBackendRef: Implementation-specific_
   */
  ExtensionRef: 'ExtensionRef',
} as const;
export type HTTPRouteFilterType = (typeof HTTPRouteFilterType)[keyof typeof HTTPRouteFilterType];

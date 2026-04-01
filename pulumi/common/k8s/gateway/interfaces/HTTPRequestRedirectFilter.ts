import type { Input } from '@pulumi/pulumi';
import type { HTTPPathModifier } from './HTTPPathModifier.ts';

/**
 * Defines a filter that redirects a request.
 *
 * This filter MUST NOT be used on the same Route rule as a HTTPURLRewrite filter.
 */
export interface HTTPRequestRedirectFilter {
  /**
   * Scheme is the scheme to be used in the value of the `Location` header in
   * the response. When empty, the scheme of the request is used.
   *
   * Scheme redirects can affect the port of the redirect, for more information,
   * refer to the documentation for the port field of this filter.
   *
   * Note that values may be added to this enum, implementations
   * must ensure that unknown values will not cause a crash.
   *
   * Unknown values here must result in the implementation setting the
   * Accepted Condition for the Route to `status: False`, with a
   * Reason of UnsupportedValue.
   *
   * _Support: Extended_
   */
  scheme?: Input<string>;

  /**
   * Hostname is the hostname to be used in the value of the `Location`
   * header in the response.
   *
   * When empty, the hostname in the `Host` header of the request is used.
   *
   * _Support: Core_
   */
  hostname?: Input<string>;

  /**
   * Path defines parameters used to modify the path of the incoming request.
   *
   * The modified path is then used to construct the `Location` header. When
   * empty, the request path is used as-is.
   *
   * _Support: Extended_
   */
  path?: Input<HTTPPathModifier>;

  /**
   * Port is the port to be used in the value of the Location
   * header in the response.
   *
   * If no port is specified, the redirect port MUST be derived using the
   * following rules:
   * - If redirect scheme is not-empty, the redirect port MUST be the well-known
   *   port associated with the redirect scheme. Specifically `http` to port 80
   *   and `https` to port 443. If the redirect scheme does not have a
   *   well-known port, the listener port of the Gateway SHOULD be used.
   * - If redirect scheme is empty, the redirect port MUST be the Gateway
   *   Listener port.
   *
   * Implementations SHOULD NOT add the port number in the 'Location'
   * header in the following cases:
   * - A `Location` header that will use HTTP (whether that is determined via
   *   the Listener protocol or the Scheme field) and use port 80.
   * - A `Location` header that will use HTTPS (whether that is determined via
   *   the Listener protocol or the Scheme field) and use port 443.
   *
   * _Support: Extended_
   */
  port?: Input<number>;

  /**
   * StatusCode is the HTTP status code to be used in response.
   *
   * Note that values may be added to this enum, implementations
   * must ensure that unknown values will not cause a crash.
   *
   * Unknown values here must result in the implementation setting the
   * Accepted Condition for the Route to `status: False`, with a
   * Reason of UnsupportedValue.
   *
   * Defaults to `302`.
   *
   * _Support: Core_
   */
  statusCode?: Input<number>;
}

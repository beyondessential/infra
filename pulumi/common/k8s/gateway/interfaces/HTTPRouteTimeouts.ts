import type { Input } from '@pulumi/pulumi';
import type { Duration } from '../types/Duration.ts';

/**
 * Defines timeouts that can be configured for an HTTPRoute.
 * Timeout values are represented with Gateway API Duration formatting.
 */
export interface HTTPRouteTimeouts {
  /**
   * Request specifies the maximum duration for a gateway to respond to an HTTP request.
   *
   * If the gateway has not been able to respond before this deadline is met, the gateway
   * MUST return a timeout error.
   *
   * For example, setting the rules.timeouts.request field to the value 10s in an
   * HTTPRoute will cause a timeout if a client request is taking longer than 10 seconds
   * to complete.
   *
   * Setting a timeout to the zero duration (e.g. "0s") SHOULD disable the timeout
   * completely. Implementations that cannot completely disable the timeout MUST
   * instead interpret the zero duration as the longest possible value to which
   * the timeout can be set.
   *
   * This timeout is intended to cover as close to the whole request-response transaction
   * as possible although an implementation MAY choose to start the timeout after the entire
   * request stream has been received instead of immediately after the transaction is
   * initiated by the client.
   *
   * When this field is unspecified, request timeout behavior is implementation-specific.
   *
   * _Support: Extended_
   */
  request?: Input<Duration>;

  /**
   * BackendRequest specifies a timeout for an individual request from the gateway
   * to a backend. This covers the time from when the request first starts being
   * sent from the gateway to when the full response has been received from the backend.
   * Setting a timeout to the zero duration (e.g. "0s") SHOULD disable the timeout
   * completely. Implementations that cannot completely disable the timeout MUST
   * instead interpret the zero duration as the longest possible value to which
   * the timeout can be set.
   *
   * An entire client HTTP transaction with a gateway, covered by the Request timeout,
   * may result in more than one call from the gateway to the destination backend,
   * for example, if automatic retries are supported.
   *
   * When this field is unspecified, its behavior is implementation-specific;
   * when specified, the value of BackendRequest must be no more than the value of the
   * Request timeout (since the Request timeout encompasses the BackendRequest timeout).
   *
   * _Support: Extended_
   */
  backendRequest?: Input<Duration>;
}

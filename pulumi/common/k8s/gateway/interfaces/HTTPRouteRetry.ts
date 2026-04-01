import type { Input } from '@pulumi/pulumi';
import type { Duration } from '../types/Duration.ts';

/**
 * HTTPRouteRetry defines retry configuration for an HTTPRoute.
 *
 * Implementations SHOULD retry on connection errors (disconnect,
 * reset, timeout, TCP failure) if a retry stanza is configured.
 */
export interface HTTPRouteRetry {
  /**
   * Codes defines the HTTP response status codes for which
   * a backend request should be retried.
   *
   * _Support: Extended_
   */
  codes: Input<Array<Input<HTTPRouteRetryStatusCode>>>;

  /**
   * Attempts specifies the maximum number of times an individual request
   * from the gateway to a backend should be retried.
   *
   * If the maximum number of retries has been attempted without a successful
   * response from the backend, the Gateway MUST return an error.
   *
   * When this field is unspecified, the number of times to attempt to retry
   * a backend request is implementation-specific.
   *
   * _Support: Extended_
   */
  attempts?: Input<number>;

  /**
   * Backoff specifies the minimum duration a Gateway should wait between
   * retry attempts and is represented in Gateway API Duration formatting.
   * For example, setting the rules[].retry.backoff field to the value
   * 100ms will cause a backend request to first be retried approximately
   * 100 milliseconds after timing out or receiving a response code configured
   * to be retriable.
   *
   * An implementation MAY use an exponential or alternative backoff strategy
   * for subsequent retry attempts, MAY cap the maximum backoff duration to
   * some amount greater than the specified minimum, and MAY add arbitrary
   * jitter to stagger requests, as long as unsuccessful backend requests are
   * not retried before the configured minimum duration.
   *
   * If a Request timeout (rules[].timeouts.request) is configured on the
   * route, the entire duration of the initial request and any retry attempts
   * MUST not exceed the Request timeout duration. If any retry attempts are
   * still in progress when the Request timeout duration has been reached,
   * these SHOULD be canceled if possible and the Gateway MUST immediately
   * return a timeout error.
   *
   * If a BackendRequest timeout (rules[].timeouts.backendRequest) is
   * configured on the route, any retry attempts which reach the configured
   * BackendRequest timeout duration without a response SHOULD be canceled if
   * possible and the Gateway should wait for at least the specified backoff
   * duration before attempting to retry the backend request again.
   *
   * If a BackendRequest timeout is not configured on the route, retry
   * attempts MAY time out after an implementation default duration, or MAY
   * remain pending until a configured Request timeout or implementation
   * default duration for total request time is reached.
   *
   * When this field is unspecified, the time to wait between retry attempts
   * is implementation-specific.
   *
   * _Support: Extended_
   */
  backoff?: Input<Duration>;
}

/**
 * An HTTP response status code for which a backend request should be retried.
 *
 * - 500, 502, 503, and 504 are always supported.
 * - additional discrete values in the 500-599 range may be supported.
 * - additional discrete values in the 400-499 range may also be supported,
 *   but are usually not a good idea to retry.
 */
export type HTTPRouteRetryStatusCode = 500 | 502 | 503 | 504 | number;

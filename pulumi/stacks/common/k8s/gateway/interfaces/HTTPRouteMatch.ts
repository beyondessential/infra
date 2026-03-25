import type { Input } from '@pulumi/pulumi';
import type { HTTPMethod } from '../consts/HTTPMethod.ts';

/**
 * Defines the predicate used to match requests to a given action.
 *
 * Multiple match types are ANDed together, i.e. the match will
 * evaluate to true only if all conditions are satisfied.
 */
export interface HTTPRouteMatch {
  /**
   * Path specifies a HTTP request path matcher. If this field is not
   * specified, a default prefix match on the `/` path is provided.
   */
  path?: Input<HTTPPathMatch>;

  /**
   * Headers specifies HTTP request header matchers. Multiple match values are
   * ANDed together, meaning, a request must match all the specified headers
   * to select the route.
   */
  headers?: Input<Array<Input<HTTPHeaderMatch>>>;

  /**
   * QueryParams specifies HTTP query parameter matchers. Multiple match
   * values are ANDed together, meaning, a request must match all the
   * specified query parameters to select the route.
   *
   * _Support: Extended_
   */
  queryParams?: Input<Array<Input<HTTPQueryParamMatch>>>;

  /**
   * Method specifies HTTP method matcher.
   *
   * When specified, this route will be matched only if the request has the
   * specified method.
   *
   * _Support: Extended_
   */
  method?: Input<HTTPMethod>;
}

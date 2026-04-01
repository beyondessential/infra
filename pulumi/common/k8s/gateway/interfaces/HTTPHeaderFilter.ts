import type { Input } from '@pulumi/pulumi';
import type { HTTPHeader } from './HTTPHeader.ts';

/**
 * Defines a filter that modifies the headers of an HTTP request or response.
 *
 * Only one action for a given header name is permitted. Filters specifying
 * multiple actions of the same or different type for any one header name are
 * invalid. Configuration to set or add multiple values for a header must use
 * RFC 7230 header value formatting, separating each value with a comma.
 */
export interface HTTPHeaderFilter {
  /**
   * Set overwrites the request with the given header (name, value)
   * before the action.
   */
  set?: Input<Array<Input<HTTPHeader>>>;

  /**
   * Add adds the given header(s) (name, value) to the request
   * before the action. It appends to any existing values associated
   * with the header name.
   */
  add?: Input<Array<Input<HTTPHeader>>>;

  /**
   * Remove the given header(s) from the HTTP request before the action.
   */
  remove?: Input<Array<Input<string>>>;
}

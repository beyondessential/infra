import type { Input } from '@pulumi/pulumi';
import type { HTTPPathModifier } from './HTTPPathModifier.ts';

/**
 * Defines a filter that modifies a request during forwarding.
 *
 * At most one of these filters may be used on a Route rule.
 * This MUST NOT be used on the same Route rule as a HTTPRequestRedirect filter.
 */
export interface HTTPURLRewriteFilter {
  /**
   * Hostname is the value to be used to replace the Host header value during
   * forwarding.
   *
   * _Support: Extended_
   */
  hostname: Input<string>;

  /**
   * Path defines a path rewrite.
   *
   * _Support: Extended_
   */
  path: Input<HTTPPathModifier>;
}

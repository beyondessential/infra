import type { Input } from '@pulumi/pulumi';
import type { PathMatchType } from '../consts/PathMatchType.ts';

/**
 * Describes how to select a HTTP route by matching the HTTP request path.
 */
export interface HTTPPathMatch {
  /**
   * Type specifies how to match against the path Value.
   *
   * Defaults to `PathPrefix`.
   *
   * _Support: Core (Exact, PathPrefix)_
   *
   * _Support: Implementation-specific (RegularExpression)_
   */
  type?: Input<PathMatchType>;

  /**
   * Value of the HTTP path to match against.
   *
   * Defaults to `/`.
   */
  value?: Input<string>;
}

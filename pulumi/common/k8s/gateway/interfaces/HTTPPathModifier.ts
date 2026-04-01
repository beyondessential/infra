import type { Input } from '@pulumi/pulumi';
import type { HTTPPathModifierType } from '../consts/HTTPPathModifierType.ts';

/**
 * Defines configuration for path modifiers.
 */
export interface HTTPPathModifier {
  /**
   * Type defines the type of path modifier. Additional types may be
   * added in a future release of the API.
   *
   * Note that values may be added to this enum, implementations
   * must ensure that unknown values will not cause a crash.
   *
   * Unknown values here must result in the implementation setting the
   * Accepted Condition for the Route to `status: False`, with a
   * Reason of UnsupportedValue.
   */
  type: Input<HTTPPathModifierType>;

  /**
   * Specifies the value with which to replace the full path
   * of a request during a rewrite or redirect.
   */
  replaceFullPath?: Input<string>;

  /**
   * Specifies the value with which to replace the prefix
   * match of a request during a rewrite or redirect. For example, a request
   * to `/foo/bar` with a prefix match of `/foo` and a ReplacePrefixMatch
   * of `/xyz` would be modified to `/xyz/bar`.
   *
   * Note that this matches the behavior of the PathPrefix match type. This
   * matches full path elements. A path element refers to the list of labels
   * in the path split by the `/` separator. When specified, a trailing `/` is
   * ignored. For example, the paths `/abc`, `/abc/`, and `/abc/def` would all
   * match the prefix `/abc`, but the path `/abcd` would not.
   *
   * ReplacePrefixMatch is only compatible with a PathPrefix HTTPRouteMatch.
   *
   * Using any other HTTPRouteMatch type on the same HTTPRouteRule will result in
   * the implementation setting the Accepted Condition for the Route to `status: False`.
   */
  replacePrefixMatch?: Input<string>;
}

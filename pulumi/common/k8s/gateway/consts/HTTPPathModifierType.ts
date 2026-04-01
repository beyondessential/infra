/**
 * Defines the type of path redirect or rewrite.
 */
export const HTTPPathModifierType = {
  /**
   * This type of modifier indicates that the full path will be replaced
   * by the specified value.
   */
  ReplaceFullPath: 'ReplaceFullPath',

  /**
   * This type of modifier indicates that any prefix path matches will be
   * replaced by the substitution value. For example, a path with a prefix
   * match of `/foo` and a ReplacePrefixMatch substitution of `/bar` will have
   * the `/foo` prefix replaced with `/bar` in matching requests.
   *
   * Note that this matches the behavior of the PathPrefix match type. This
   * matches full path elements. A path element refers to the list of labels
   * in the path split by the `/` separator. When specified, a trailing `/` is
   * ignored. For example, the paths `/abc`, `/abc/`, and `/abc/def` would all
   * match the prefix `/abc`, but the path `/abcd` would not.
   */
  ReplacePrefixMatch: 'ReplacePrefixMatch',
} as const;
export type HTTPPathModifierType = (typeof HTTPPathModifierType)[keyof typeof HTTPPathModifierType];

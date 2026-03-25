/**
 * Specifies the semantics of how HTTP paths should be compared.
 */
export const PathMatchType = {
  /**
   * Matches the URL path exactly and with case sensitivity. This means that
   * an exact path match on `/abc` will only match requests to `/abc`, NOT
   * `/abc/`, `/Abc`, or `/abcd`.
   */
  Exact: 'Exact',

  /**
   * Matches based on a URL path prefix split by `/`.
   *
   * Matching is case-sensitive and done on a path element by element basis.
   * A path element refers to the list of labels in the path split by
   * the `/` separator. When specified, a trailing `/` is ignored.
   *
   * For example, the paths `/abc`, `/abc/`, and `/abc/def` would all match
   * the prefix `/abc`, but the path `/abcd` would not.
   *
   * `PathPrefix` is semantically equivalent to the `Prefix` path type in the
   * Kubernetes Ingress API.
   */
  PathPrefix: 'PathPrefix',

  /**
   * Matches if the URL path matches the given regular expression with
   * case sensitivity.
   *
   * Since `RegularExpression` has implementation-specific conformance,
   * implementations can support POSIX, PCRE, RE2 or any other regular expression
   * dialect.
   *
   * Please read the implementation's documentation to determine the supported
   * dialect.
   */
  RegularExpression: 'RegularExpression',
} as const;
export type PathMatchType = (typeof PathMatchType)[keyof typeof PathMatchType];

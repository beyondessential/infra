/**
 * Specifies the semantics of how HTTP query parameter values should be compared.
 */
export const QueryParamMatchType = {
  Exact: 'Exact',
  RegularExpression: 'RegularExpression',
} as const;
export type QueryParamMatchType = (typeof QueryParamMatchType)[keyof typeof QueryParamMatchType];

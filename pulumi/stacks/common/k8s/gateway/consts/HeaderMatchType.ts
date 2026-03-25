/**
 * Specifies the semantics of how HTTP header values should be compared.
 */
export const HeaderMatchType = {
  Exact: 'Exact',
  RegularExpression: 'RegularExpression',
} as const;
export type HeaderMatchType = (typeof HeaderMatchType)[keyof typeof HeaderMatchType];

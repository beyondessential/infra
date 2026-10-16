/**
 * GatewayDefaultScope defines the set of default scopes that a Gateway can claim,
 * for use in any Route type. At present the only supported scopes are `All` and `None`.
 * `None` is a special scope which explicitly means that the Route MUST NOT attached
 * to any default Gateway.
 */
export const GatewayDefaultScope = {
  /**
   * GatewayDefaultScopeAll indicates that a Gateway can claim absolutely
   * any Route asking for a default Gateway.
   */
  All: 'All',

  /**
   * GatewayDefaultScopeNone indicates that a Gateway MUST NOT claim
   * any Route asking for a default Gateway.
   */
  None: 'None',
} as const;
export type GatewayDefaultScope = (typeof GatewayDefaultScope)[keyof typeof GatewayDefaultScope];

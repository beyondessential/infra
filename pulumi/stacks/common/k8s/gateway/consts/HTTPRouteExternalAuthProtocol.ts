/**
 * Specifies what protocol should be used for communicating
 * with an external authorization server.
 */
export const HTTPRouteExternalAuthProtocol = {
  GRPC: 'GRPC',
  HTTP: 'HTTP',
} as const;
export type HTTPRouteExternalAuthProtocol =
  (typeof HTTPRouteExternalAuthProtocol)[keyof typeof HTTPRouteExternalAuthProtocol];

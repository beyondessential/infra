/**
 * TLSModeType type defines how a Gateway handles TLS sessions.
 */
export const TLSModeType = {
  /**
   * In this mode, TLS session between the downstream client
   * and the Gateway is terminated at the Gateway.
   */
  Terminate: 'Terminate',

  /**
   * In this mode, the TLS session is NOT terminated by the Gateway. This
   * implies that the Gateway can't decipher the TLS stream except for
   * the ClientHello message of the TLS protocol.
   *
   * Note that SSL passthrough is only supported by TLSRoute.
   */
  Passthrough: 'Passthrough',
} as const;
export type TLSModeType = (typeof TLSModeType)[keyof typeof TLSModeType];

/**
 * FrontendValidationModeType type defines how a Gateway validates client certificates.
 */
export const FrontendValidationModeType = {
  /**
   * `AllowValidOnly` indicates that a client certificate is required
   * during the TLS handshake and MUST pass validation.
   *
   * _Support: Core_
   */
  AllowValidOnly: 'AllowValidOnly',

  /**
   * `AllowInsecureFallback` indicates that a client certificate may not be
   * presented during the handshake or the validation against CA certificates may fail.
   *
   * _Support: Extended_
   */
  AllowInsecureFallback: 'AllowInsecureFallback',
} as const;
export type FrontendValidationModeType =
  (typeof FrontendValidationModeType)[keyof typeof FrontendValidationModeType];

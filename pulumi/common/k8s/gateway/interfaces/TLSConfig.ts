import type { Input } from '@pulumi/pulumi';
import type { FrontendTLSValidation } from './FrontendTLSValidation.ts';

/**
 * TLSConfig describes TLS configuration that can apply to multiple Listeners
 * within this Gateway. Currently, it stores only the client certificate validation
 * configuration, but this may be extended in the future.
 */
export interface TLSConfig {
  /**
   * Validation holds configuration information for validating the frontend (client).
   *
   * Setting this field will result in mutual authentication when connecting to the gateway.
   *
   * In browsers this may result in a dialog appearing
   * that requests a user to specify the client certificate.
   *
   * The maximum depth of a certificate chain accepted in verification is Implementation specific.
   *
   * _Support: Core_
   */
  validation?: Input<FrontendTLSValidation>;
}

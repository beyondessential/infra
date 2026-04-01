import type { Input } from '@pulumi/pulumi';
import type { GatewayBackendTLS } from './GatewayBackendTLS.ts';
import type { FrontendTLSConfig } from './FrontendTLSConfig.ts';

/**
 * GatewayTLSConfig specifies frontend and backend tls configuration for gateway.
 */
export interface GatewayTLSConfig {
  /**
   * Backend describes TLS configuration for gateway when connecting to backends.
   *
   * Note that this contains only details for the Gateway as a TLS client,
   * and does not imply behavior about how to choose which backend should
   * get a TLS connection. That is determined by the presence of a BackendTLSPolicy.
   *
   * _Support: Core_
   */
  backend?: Input<GatewayBackendTLS>;

  /**
   * Frontend describes TLS config when client connects to Gateway.
   *
   * _Support: Core_
   */
  frontend?: Input<FrontendTLSConfig>;
}

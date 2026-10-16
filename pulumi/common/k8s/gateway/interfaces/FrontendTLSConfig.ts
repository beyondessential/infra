import type { Input } from '@pulumi/pulumi';
import type { TLSConfig } from './TLSConfig.ts';
import type { TLSPortConfig } from './TLSPortConfig.ts';

/**
 * FrontendTLSConfig specifies frontend tls configuration for gateway.
 */
export interface FrontendTLSConfig {
  /**
   * Default specifies the default client certificate validation configuration
   * for all Listeners handling HTTPS traffic, unless a per-port configuration
   * is defined.
   *
   * _Support: Core_
   */
  default?: Input<TLSConfig>;

  /**
   * PerPort specifies tls configuration assigned per port.
   *
   * Per port configuration is optional. Once set this configuration overrides
   * the default configuration for all Listeners handling HTTPS traffic
   * that match this port.
   *
   * Each override port requires a unique TLS configuration.
   *
   * _Support: Core_
   */
  perPort?: Input<Array<Input<TLSPortConfig>>>;
}

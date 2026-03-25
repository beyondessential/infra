import type { Input } from '@pulumi/pulumi';
import type { TLSConfig } from './TLSConfig.ts';

export interface TLSPortConfig {
  /**
   * The Port indicates the Port Number to which the TLS configuration will be
   * applied. This configuration will be applied to all Listeners handling HTTPS
   * traffic that match this port.
   *
   * _Support: Core_
   */
  port: Input<number>;

  /**
   * TLS store the configuration that will be applied to all Listeners handling
   * HTTPS traffic and matching given port.
   *
   * _Support: Core_
   */
  tls: Input<TLSConfig>;
}

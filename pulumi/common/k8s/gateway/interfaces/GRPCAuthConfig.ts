import type { Input } from '@pulumi/pulumi';

/**
 * Contains configuration for communication with Auth server backends that speak
 * Envoy's `ext_authz` gRPC protocol.
 *
 * Requests and responses are defined in the protobufs explained at:
 * <https://www.envoyproxy.io/docs/envoy/latest/api-v3/service/auth/v3/external_auth.proto>.
 */
export interface GRPCAuthConfig {
  /**
   * Specifies what headers from the client request will be sent to the
   * authorization server.
   *
   * If this list is empty, then all headers must be sent.
   *
   * If the list has entries, only those entries must be sent.
   */
  allowedHeaders: Input<Array<Input<string>>>;
}

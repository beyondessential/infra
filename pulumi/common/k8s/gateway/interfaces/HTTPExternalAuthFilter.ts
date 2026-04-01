import type { Input } from '@pulumi/pulumi';
import type { ForwardBodyConfig } from './ForwardBodyConfig.ts';
import type { HTTPAuthConfig } from './HTTPAuthConfig.ts';
import type { GRPCAuthConfig } from './GRPCAuthConfig.ts';
import type { BackendObjectReference } from './BackendObjectReference.ts';
import type { HTTPRouteExternalAuthProtocol } from '../consts/HTTPRouteExternalAuthProtocol.ts';

/**
 * Defines a filter that modifies requests by sending request details
 * to an external authorization server.
 *
 * _Support: Extended_
 *
 * _Feature Name: HTTPRouteExternalAuth_
 */
export interface HTTPExternalAuthFilter {
  /**
   * ExternalAuthProtocol describes which protocol to use when communicating with an
   * ext_authz authorization server.
   *
   * When this is set to GRPC, each backend must use the Envoy ext_authz protocol
   * on the port specified in backendRefs. Requests and responses are defined
   * in the protobufs explained at:
   * <https://www.envoyproxy.io/docs/envoy/latest/api-v3/service/auth/v3/external_auth.proto>
   *
   * When this is set to HTTP, each backend must respond with a 200 status
   * code in on a successful authorization. Any other code is considered
   * an authorization failure.
   *
   * Feature Names:
   * - GRPC Support - HTTPRouteExternalAuthGRPC
   * - HTTP Support - HTTPRouteExternalAuthHTTP
   */
  protocol: Input<HTTPRouteExternalAuthProtocol>;

  /**
   * BackendRef is a reference to a backend to send authorization
   * requests to.
   *
   * The backend must speak the selected protocol (GRPC or HTTP) on the
   * referenced port.
   *
   * If the backend service requires TLS, use BackendTLSPolicy to tell the
   * implementation to supply the TLS details to be used to connect to that
   * backend.
   */
  backendRef: Input<BackendObjectReference>;

  /**
   * GRPCAuthConfig contains configuration for communication with ext_authz
   * protocol-speaking backends.
   *
   * If unset, implementations must assume the default behavior for each
   * included field is intended.
   */
  grpc?: Input<GRPCAuthConfig>;

  /**
   * HTTPAuthConfig contains configuration for communication with
   * HTTP-speaking backends.
   *
   * If unset, implementations must assume the default behavior for each
   * included field is intended.
   */
  http?: Input<HTTPAuthConfig>;

  /**
   * ForwardBody controls if requests to the authorization server should include
   * the body of the client request; and if so, how big that body is allowed
   * to be.
   *
   * It is expected that implementations will buffer the request body up to
   * `forwardBody.maxSize` bytes. Bodies over that size must be rejected with a
   * 4xx series error (413 or 403 are common examples), and fail processing
   * of the filter.
   *
   * If unset, or `forwardBody.maxSize` is set to `0`, then the body will not
   * be forwarded.
   *
   * _Feature Name: HTTPRouteExternalAuthForwardBody_
   */
  forwardBody?: Input<ForwardBodyConfig>;
}

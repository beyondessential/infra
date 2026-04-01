import type { Input } from '@pulumi/pulumi';
import type { ListenerTLSConfig } from './ListenerTLSConfig.ts';
import type { AllowedRoutes } from './AllowedRoutes.ts';

/**
 * Listener embodies the concept of a logical endpoint
 * where a Gateway accepts network connections.
 */
export interface Listener {
  /**
   * Name is the name of the Listener. This name MUST be unique within a Gateway.
   *
   * _Support: Core_
   */
  name: Input<string>;

  /**
   * Hostname specifies the virtual hostname to match for protocol types that
   * define this concept. When unspecified, all hostnames are matched. This
   * field is ignored for protocols that don't require hostname based
   * matching.
   *
   * Implementations MUST apply Hostname matching appropriately for each of
   * the following protocols:
   * - TLS: The Listener Hostname MUST match the SNI.
   * - HTTP: The Listener Hostname MUST match the Host header of the request.
   * - HTTPS: The Listener Hostname SHOULD match both the SNI and Host header.
   *
   * Note that this does not require the SNI and Host header to be the same.
   * The semantics of this are described in more detail below.
   *
   * To ensure security, Section 11.1 of RFC-6066 emphasizes that server
   * implementations that rely on SNI hostname matching MUST also verify
   * hostnames within the application protocol.
   *
   * Section 9.1.2 of RFC-7540 provides a mechanism for servers to reject the
   * reuse of a connection by responding with the HTTP 421 Misdirected Request
   * status code. This indicates that the origin server has rejected the
   * request because it appears to have been misdirected.
   *
   * To detect misdirected requests, Gateways SHOULD match the authority of
   * the requests with all the SNI hostname(s) configured across all the
   * Gateway Listeners on the same port and protocol:
   *
   * - If another Listener has an exact match or more specific wildcard entry,
   *   the Gateway SHOULD return a 421.
   * - If the current Listener (selected by SNI matching during ClientHello)
   *   does not match the Host:
   * - If another Listener does match the Host, the Gateway SHOULD return a
   *   421.
   * - If no other Listener matches the Host, the Gateway MUST return a
   *   404.
   *
   * For HTTPRoute and TLSRoute resources, there is an interaction with the
   * `spec.hostnames` array. When both listener and route specify hostnames,
   * there MUST be an intersection between the values for a Route to be
   * accepted. For more information, refer to the Route specific Hostnames
   * documentation.
   *
   * Hostnames that are prefixed with a wildcard label (`*.`) are interpreted
   * as a suffix match. That means that a match for `*.example.com` would match
   * both `test.example.com`, and `foo.test.example.com`, but not `example.com`.
   *
   * _Support: Core_
   */
  hostname: Input<string>;

  /**
   * Port is the network port. Multiple listeners may use the
   * same port, subject to the Listener compatibility rules.
   *
   * _Support: Core_
   */
  port: Input<number>;

  /**
   * Protocol specifies the network protocol this listener expects to receive.
   *
   * Can be any string. These values are standard:
   * - `HTTP`: Accepts cleartext HTTP/1.1 sessions over TCP. Implementations
   *   MAY also support HTTP/2 over cleartext. If implementations support HTTP/2
   *   over cleartext on "HTTP" listeners, that MUST be clearly documented by the
   *   implementation.
   * - `HTTPS`: Accepts HTTP/1.1 or HTTP/2 sessions over TLS.
   * - `TLS`: Accepts TLS sessions over TCP.
   * - `TCP`: Accepts TCP sessions.
   * - `UDP`: Accepts UDP packets.
   *
   * Custom values must use prefixed names, such as `mycompany.com/my-custom-protocol`.
   *
   * _Support: Core_
   */
  protocol: Input<string>;

  /**
   * TLS is the TLS configuration for the Listener. This field is required if
   * the Protocol field is `HTTPS` or `TLS`. It is invalid to set this field
   * if the Protocol field is `HTTP`, `TCP`, or `UDP`.
   *
   * The association of SNIs to Certificate defined in ListenerTLSConfig is
   * defined based on the Hostname field for this listener.
   *
   * The GatewayClass MUST use the longest matching SNI out of all
   * available certificates for any TLS handshake.
   *
   * _Support: Core_
   */
  tls?: Input<ListenerTLSConfig>;

  /**
   * AllowedRoutes defines the types of routes that MAY be attached to a
   * Listener and the trusted namespaces where those Route resources MAY be
   * present.
   *
   * Although a client request may match multiple route rules, only one rule
   * may ultimately receive the request. Matching precedence MUST be
   * determined in order of the following criteria:
   *
   * - The most specific match as defined by the Route type.
   * - The oldest Route based on creation timestamp. For example, a Route with
   *   a creation timestamp of `2020-09-08 01:02:03` is given precedence over
   *   a Route with a creation timestamp of `2020-09-08 01:02:04`.
   * - If everything else is equivalent, the Route appearing first in
   *   alphabetical order (namespace/name) should be given precedence. For
   *   example, foo/bar is given precedence over foo/baz.
   *
   * All valid rules within a Route attached to this Listener should be
   * implemented. Invalid Route rules can be ignored (sometimes that will mean
   * the full Route). If a Route rule transitions from valid to invalid,
   * support for that Route rule should be dropped to ensure consistency. For
   * example, even if a filter specified by a Route rule is invalid, the rest
   * of the rules within that Route should still be supported.
   *
   * _Support: Core_
   */
  allowedRoutes?: Input<AllowedRoutes>;
}

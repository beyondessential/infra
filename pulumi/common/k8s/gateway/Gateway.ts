import { output, type CustomResourceOptions, type Input } from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';
import type { Listener } from './interfaces/Listener.ts';
import type { GatewaySpecAddress } from './interfaces/GatewaySpecAddress.ts';
import type { GatewayInfrastructure } from './interfaces/GatewayInfrastructure.ts';
import type { AllowedListeners } from './interfaces/AllowedListeners.ts';
import type { GatewayTLSConfig } from './interfaces/GatewayTLSConfig.ts';
import type { GatewayDefaultScope } from './consts/GatewayDefaultScope.ts';
import { API_GROUP, API_VERSION, EG_API_VERSION } from './consts/API.ts';

export interface GatewayArgs {
  metadata: Input<k8s.types.input.meta.v1.ObjectMeta>;
  spec: Input<GatewaySpec>;
  /**
   * Extra fields to merge into the ClientTrafficPolicy spec that is
   * automatically created alongside this Gateway. Use this to add
   * settings (e.g. TLS clientValidation, headers.xForwardedClientCert)
   * that are not part of the standard Gateway spec.
   */
  clientTrafficPolicyExtraSpec?: Record<string, unknown>;
}

export interface GatewaySpec {
  /**
   * GatewayClassName used for this Gateway. This is the name of a
   * GatewayClass resource.
   */
  gatewayClassName: Input<string>;

  /**
   * Listeners associated with this Gateway. Listeners define
   * logical endpoints that are bound on this Gateway's addresses.
   * At least one Listener MUST be specified, and no more than 64.
   *
   * ## Distinct Listeners
   *
   * Each Listener in a set of Listeners (for example, in a single Gateway)
   * MUST be distinct, in that a traffic flow MUST be able to be assigned to
   * exactly one listener. (This section uses "set of Listeners" rather than
   * "Listeners in a single Gateway" because implementations MAY merge configuration
   * from multiple Gateways onto a single data plane, and these rules also
   * apply in that case).
   *
   * Practically, this means that each listener in a set MUST have a unique
   * combination of Port, Protocol, and, if supported by the protocol, Hostname.
   * Some combinations of port, protocol, and TLS settings are considered
   * _Core_ support and MUST be supported by implementations based on the objects
   * they support:
   *
   * #### HTTPRoute
   * 1. `HTTPRoute`, Port: 80, Protocol: HTTP
   * 2. `HTTPRoute`, Port: 443, Protocol: HTTPS, TLS Mode: Terminate, TLS keypair provided
   *
   * #### TLSRoute
   * 1. `TLSRoute`, Port: 443, Protocol: TLS, TLS Mode: Passthrough
   *
   * "Distinct" Listeners have the following property:
   * The implementation can match inbound requests to a single distinct
   * Listener.
   *
   * When multiple Listeners share values for fields (for
   * example, two Listeners with the same Port value), the implementation
   * can match requests to only one of the Listeners using other
   * Listener fields.
   *
   * When multiple listeners have the same value for the Protocol field, then
   * each of the Listeners with matching Protocol values MUST have different
   * values for other fields.
   *
   * The set of fields that MUST be different for a Listener differs per protocol.
   * The following rules define the rules for what fields MUST be considered for
   * Listeners to be distinct with each protocol currently defined in the
   * Gateway API spec.
   *
   * The set of listeners that all share a protocol value MUST have different
   * values for at least one of these fields to be distinct:
   * - HTTP, HTTPS, TLS: Port, Hostname
   * - TCP, UDP: Port
   *
   * One very important rule to call out involves what happens when an
   * implementation:
   * - Supports TCP protocol Listeners, as well as HTTP, HTTPS, or TLS protocol
   *   Listeners, and
   * - sees HTTP, HTTPS, or TLS protocols with the same port as one with TCP
   *   Protocol.
   *
   * In this case all the Listeners that share a port with the
   * TCP Listener are not distinct and so MUST NOT be accepted.
   *
   * If an implementation does not support TCP Protocol Listeners, then the
   * previous rule does not apply, and the TCP Listeners SHOULD NOT be
   * accepted.
   *
   * Note that the tls field is not used for determining if a listener is distinct, because
   * Listeners that only differ on TLS config will still conflict in all cases.
   *
   * ### Listeners that are distinct only by Hostname
   *
   * When the Listeners are distinct based only on Hostname, inbound request
   * hostnames MUST match from the most specific to least specific Hostname
   * values to choose the correct Listener and its associated set of Routes.
   *
   * Exact matches MUST be processed before wildcard matches, and wildcard
   * matches MUST be processed before fallback (empty Hostname value)
   * matches. For example, `foo.example.com` takes precedence over
   * `*.example.com`, and `*.example.com` takes precedence over ``.
   *
   * Additionally, if there are multiple wildcard entries, more specific
   * wildcard entries must be processed before less specific wildcard entries.
   * For example, `*.foo.example.com` takes precedence over `*.example.com`.
   *
   * The precise definition here is that the higher the number of dots in the
   * hostname to the right of the wildcard character, the higher the precedence.
   * The wildcard character will match any number of characters and dots to
   * the left, however, so `*.example.com` will match both
   * `foo.bar.example.com` and `bar.example.com`.
   *
   * ## Handling indistinct Listeners
   *
   * If a set of Listeners contains Listeners that are not distinct, then those
   * Listeners are Conflicted, and the implementation MUST set the `Conflicted`
   * condition in the Listener Status to `True`.
   *
   * The words "indistinct" and "conflicted" are considered equivalent for the
   * purpose of this documentation.
   *
   * Implementations MAY choose to accept a Gateway with some Conflicted
   * Listeners only if they only accept the partial Listener set that contains
   * no Conflicted Listeners.
   *
   * Specifically, an implementation MAY accept a partial Listener set subject to
   * the following rules:
   * - The implementation MUST NOT pick one conflicting Listener as the winner.
   * - ALL indistinct Listeners must not be accepted for processing.
   * - At least one distinct Listener MUST be present, or else the Gateway effectively
   *   contains no Listeners, and must be rejected from processing as a whole.
   * - The implementation MUST set a `ListenersNotValid` condition on the
   *   Gateway Status when the Gateway contains Conflicted Listeners whether or
   *   not they accept the Gateway. That Condition SHOULD clearly
   *   indicate in the Message which Listeners are conflicted, and which are
   *   Accepted. Additionally, the Listener status for those listeners SHOULD
   *   indicate which Listeners are conflicted and not Accepted.
   *
   * ## General Listener behavior
   *
   * Note that, for all distinct Listeners, requests SHOULD match at most one Listener.
   *
   * For example, if Listeners are defined for `foo.example.com` and `.example.com`, a
   * request to `foo.example.com` SHOULD only be routed using routes attached
   * to the `foo.example.com` Listener (and not the `.example.com` Listener).
   *
   * If traffic to a Gateway does not match any Listener's hostname (or if
   * the Listener does not specify a hostname and the request does not match
   * any attached Route), the request MUST be rejected. The specific mechanism
   * for rejection depends on the protocol: HTTP returns a 404 status code,
   * while gRPC returns an Unimplemented status code.
   *
   * This concept is known as "Listener Isolation", and it is an _Extended_ feature
   * of Gateway API. Implementations that do not support Listener Isolation MUST
   * clearly document this, and MUST NOT claim support for the
   * GatewayHTTPListenerIsolation feature.
   *
   * Implementations that do support Listener Isolation SHOULD claim support
   * for the _Extended_ GatewayHTTPListenerIsolation feature and pass the associated
   * conformance tests.
   *
   * ## Compatible Listeners
   *
   * A Gateway's Listeners are considered compatible if:
   * 1. They are distinct.
   * 2. The implementation can serve them in compliance with the Addresses
   *    requirement that all Listeners are available on all assigned
   *    addresses.
   *
   * Compatible combinations in _Extended_ support are expected to vary across
   * implementations. A combination that is compatible for one implementation
   * may not be compatible for another.
   *
   * For example, an implementation that cannot serve both TCP and UDP listeners
   * on the same address, or cannot mix HTTPS and generic TLS listens on the same port
   * would not consider those cases compatible, even though they are distinct.
   *
   * Implementations MAY merge separate Gateways onto a single set of
   * Addresses if all Listeners across all Gateways are compatible.
   *
   * In a future release the `MinItems=1` requirement MAY be dropped.
   *
   * _Support: Core_
   */
  listeners: Input<Array<Input<Listener>>>;

  /**
   * Addresses requested for this Gateway (max 16).
   *
   * This is optional and behavior can depend on the implementation.
   * If a value is set in the spec and the requested address is invalid
   * or unavailable, the implementation MUST indicate this in an associated
   * entry in GatewayStatus.Conditions.
   *
   * The Addresses field represents a request for the address(es) on the
   * "outside of the Gateway", that traffic bound for this Gateway will use.
   * This could be the IP address or hostname of an external load balancer or
   * other networking infrastructure, or some other address that traffic will
   * be sent to.
   *
   * If no Addresses are specified, the implementation MAY schedule the
   * Gateway in an implementation-specific manner, assigning an appropriate
   * set of Addresses.
   *
   * The implementation MUST bind all Listeners to every GatewayAddress that
   * it assigns to the Gateway and add a corresponding entry in
   * `status.addresses`.
   *
   * _Support: Extended_
   */
  addresses?: Input<Array<Input<GatewaySpecAddress>>>;

  /**
   * Infrastructure defines infrastructure level attributes about this Gateway instance.
   *
   * _Support: Extended_
   */
  infrastructure?: Input<GatewayInfrastructure>;

  /**
   * AllowedListeners defines which ListenerSets can be attached to this Gateway.
   *
   * The default value is to allow no ListenerSets.
   */
  allowedListeners?: Input<AllowedListeners>;

  /**
   * TLS specifies frontend and backend tls configuration for entire gateway.
   *
   * _Support: Extended_
   */
  tls?: Input<GatewayTLSConfig>;

  /**
   * DefaultScope, when set, configures the Gateway as a default Gateway,
   * meaning it will dynamically and implicitly have Routes (e.g. HTTPRoute)
   * attached to it, according to the scope configured here.
   *
   * If unset (the default) or set to `None`, the Gateway will not act as a
   * default Gateway; if set, the Gateway will claim any Route with a
   * matching scope set in its UseDefaultGateway field, subject to the usual
   * rules about which routes the Gateway can attach to.
   *
   * Think carefully before using this functionality! While the normal rules
   * about which Route can apply are still enforced, it is simply easier for
   * the wrong Route to be accidentally attached to this Gateway in this
   * configuration. If the Gateway operator is not also the operator in
   * control of the scope (e.g. namespace) with tight controls and checks on
   * what kind of workloads and Routes get added in that scope, we strongly
   * recommend not using this just because it seems convenient, and instead
   * stick to direct Route attachment.
   *
   * _Support: Experimental_
   */
  defaultScope?: Input<GatewayDefaultScope>;
}

/**
 * Gateway represents an instance of a service-traffic handling
 * infrastructure by binding Listeners to a set of IP addresses.
 */
export function Gateway(
  name: string,
  args: GatewayArgs,
  opts?: CustomResourceOptions,
): k8s.apiextensions.CustomResource {
  const { clientTrafficPolicyExtraSpec, ...gatewayArgs } = args;
  const gateway = new k8s.apiextensions.CustomResource(
    name,
    {
      ...gatewayArgs,
      apiVersion: API_VERSION,
      kind: 'Gateway',
    },
    opts,
  );

  new k8s.apiextensions.CustomResource(`${name}-traffic-policy`, {
    apiVersion: EG_API_VERSION,
    kind: 'ClientTrafficPolicy',
    metadata: {
      namespace: gateway.metadata.namespace,
    },
    spec: {
      ...clientTrafficPolicyExtraSpec,

      // Enable HTTP/3
      http3: {},

      // Client IP is preserved at the IP layer via preserve_client_ip.enabled=true
      // on the NLB target group, so Envoy sees the real client IP in the connection
      // source address without needing PROXY protocol. Proxy protocol cannot be used
      // alongside HTTP/3 because the proxy_protocol listener filter is TCP-only and
      // Envoy rejects any QUIC listener that has it attached.

      targetRefs: [
        {
          group: API_GROUP,
          kind: gateway.kind,
          name: gateway.metadata.name,
        },
      ],
    },
  });

  return gateway;
}

---
id: K8SING
---

# Kubernetes ingress

## Borrowed terms

| term | meaning |
|---|---|
| NLB | An AWS Network Load Balancer ([Network Load Balancers](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)). |
| PROXY protocol | The header a load balancer prepends to a TCP connection to convey the client address ([PROXY protocol specification](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt)). |
| IngressClass | The Kubernetes resource that binds Ingress resources to a controller ([Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/#ingress-class)). |
| GatewayClass, Gateway, listener, HTTPRoute | The resources of the Kubernetes Gateway API ([Gateway API](https://gateway-api.sigs.k8s.io/)). |
| ClusterIssuer | A cert-manager resource that issues certificates for the whole cluster ([cert-manager](https://cert-manager.io/docs/)). |
| DNS-01 | The ACME challenge that proves control of a name by a DNS record ([RFC 8555 section 8.4](https://www.rfc-editor.org/rfc/rfc8555#section-8.4)). |
| ALIAS record | A Route 53 record that resolves to an AWS resource and is valid at a zone apex ([Choosing between alias and non-alias records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html)). |
| HTTP/3 | HTTP over QUIC ([RFC 9114](https://www.rfc-editor.org/rfc/rfc9114), [RFC 9000](https://www.rfc-editor.org/rfc/rfc9000)). |
| `x-forwarded-client-cert` | The request header in which a proxy conveys a client certificate to a backend ([Envoy HTTP headers](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/headers#x-forwarded-client-cert)). |

## Load balancing

An NLB MUST front the Envoy Gateway proxy pods, handling TCP 443 and UDP 443.

The NLB MUST forward UDP 443 so that clients can reach the Gateway over HTTP/3.

## Ingress classes

An IngressClass named `tailscale`, backed by the Tailscale operator, MUST exist.

> [!NOTE]
> The class serves internal tailnet access.

## Gateway

A GatewayClass named `envoy`, referencing the Envoy Gateway controller, MUST exist.

A Gateway of that class MUST have a listener on TCP 443 that terminates TLS.

A Gateway of that class MUST have a listener on UDP 443 for HTTP/3, using the same TLS configuration as the TCP 443 listener.

A Gateway of that class MUST have a listener on TCP 80 that redirects every request to HTTPS.

The Gateway MUST terminate TLS and forward requests to backend services as plain HTTP.

## Certificates

A TLS certificate MUST be provisioned by cert-manager, using the `letsencrypt` ClusterIssuer and the DNS-01 challenge resolved through Route 53.

## DNS

external-dns MUST manage the DNS records for all ingress traffic.

external-dns MUST watch the `gateway-httproute` source.

The Route 53 hosted zones that external-dns manages MUST be an explicit list.

The permission external-dns holds to change records MUST be limited to the zones in that list.

For a hostname at a zone apex, external-dns MUST create a Route 53 ALIAS record pointing at the NLB.

> [!NOTE]
> A CNAME is not valid at a zone apex.

## Envoy proxy

The Envoy proxy pods MUST be scheduled on nodes with `bes.node.purpose=ingress`.

The Envoy proxy pods MUST NOT place more than one replica in the same availability zone.

HTTP/3 MUST be enabled on the Gateway.

The Gateway MUST NOT use the PROXY protocol.

> [!NOTE]
> The PROXY protocol cannot be combined with HTTP/3 on a listener, and HTTP/3 takes precedence.

Backends MUST receive the original client IP of requests from IPv6 clients.

A backend MUST NOT rely on the client IP of a request from an IPv4 client.

> [!NOTE]
> A request from an IPv4 client reaches the Gateway with the address of the load balancer, because the proxy pods are IPv6 targets.

The Gateway MUST reject a request whose body exceeds 50 MiB.

A route MUST specify a request timeout.

> [!NOTE]
> A route that does not specify one would be left on the default timeout of the Gateway.

## Client certificates

[tamanu-meta](../overview.md#tamanu-meta) clients authenticate by presenting a self-signed TLS client certificate.

For a listener serving tamanu-meta, the Gateway MUST request a client certificate during the TLS handshake.

For a listener serving tamanu-meta, the Gateway MUST accept the connection whether or not a client certificate is presented.

The Gateway MUST NOT verify a presented client certificate against a trust anchor.

The Gateway MUST NOT require a certificate authority to be configured in order to request a client certificate.

> [!NOTE]
> The backend performs authentication, by pinning the subject public key of the certificate.

The Gateway MUST forward a presented client certificate to the backend in the `x-forwarded-client-cert` header, carrying the full certificate.

The Gateway MUST overwrite any `x-forwarded-client-cert` header that a client supplies.

The Gateway MUST remove the `mtls-certificate` and `ssl-client-cert` headers from requests to tamanu-meta.

> [!NOTE]
> A backend that trusts either of those headers then only ever sees a value set by the proxy that terminated the TLS connection of the client.

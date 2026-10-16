# Kubernetes ingress

This spec covers how traffic enters the cluster from external sources, covering
both the stable long-term state and the transition away from ingress-nginx to
Envoy Gateway.

## Load balancers

k[lb.nginx]
During the migration period, an NLB must exist fronting the ingress-nginx
controller, handling TCP 80 and TCP 443.

k[lb.nginx.real-ip]
ingress-nginx must take the client IP from the PROXY protocol header sent by its
NLB, and must not take it from an `X-Forwarded-For` header supplied by the client.

k[lb.envoy]
An NLB must exist fronting the Envoy Gateway proxy pods, handling TCP 443 and
UDP 443. The UDP 443 listener enables HTTP/3 (QUIC).

k[lb.envoy.separate]
The Envoy NLB must be separate from the nginx NLB. They must not share target
groups.

## Ingress classes (migration period)

k[ingress-class.nginx]
An IngressClass named `nginx` backed by ingress-nginx must exist during the
migration period. It is deprecated and must be removed once all workloads have
migrated to Envoy Gateway HTTPRoutes.

k[ingress-class.tailscale]
An IngressClass named `tailscale` backed by the Tailscale operator must exist.
It is used for internal tailnet access and is not subject to the nginx
deprecation.

## Gateway API

k[gateway.class]
A GatewayClass named `envoy` must exist, referencing the Envoy Gateway
controller.

k[gateway.listener.https]
A Gateway using the `envoy` GatewayClass must have a listener on TCP 443 with
TLS termination. TLS certificates are provisioned by cert-manager via DNS-01
and stored as Kubernetes Secrets.

k[gateway.listener.quic]
The same Gateway must have a listener on UDP 443 for HTTP/3 (QUIC), using the
same TLS configuration as the HTTPS listener.

k[gateway.listener.http-redirect]
The Gateway must have a listener on TCP 80 that redirects all requests to
HTTPS.

## TLS

k[tls.cert-manager]
All TLS certificates must be provisioned by cert-manager using the
`letsencrypt` ClusterIssuer, with DNS-01 challenge resolution via Route53.
This applies to both the nginx (migration period) and Envoy Gateway paths.

k[tls.termination]
TLS must be terminated at the ingress layer (nginx or Envoy Gateway). Backend
services receive plain HTTP.

## DNS

k[dns.external-dns]
external-dns must manage DNS records for all ingress traffic automatically.
Manual DNS record management for cluster workloads is not permitted.

k[dns.external-dns.sources]
external-dns must watch both `ingress` and `gateway-httproute` sources during
the migration period. Once all Ingress resources have been removed,
the `ingress` source must be removed.

k[dns.external-dns.zones]
The Route53 hosted zones managed by external-dns must be explicitly enumerated
in the k8s-core Pulumi config (`externalDnsZones`). The IAM policy for
external-dns must be derived from the same config, granting
`route53:ChangeResourceRecordSets` on those zones only.

k[dns.apex+2]
For zone apex hostnames, external-dns must create Route53
ALIAS records pointing at the NLB rather than CNAMEs, which are not valid at
the zone apex.

## Envoy Gateway configuration

k[envoy.proxy.affinity]
The Envoy proxy pods must be scheduled on nodes with
`bes.node.purpose=ingress`, mirroring the nginx controller node affinity.

k[envoy.proxy.redundancy]
The Envoy proxy pods must have a pod anti-affinity rule preventing co-location
of multiple replicas in the same availability zone.

k[envoy.http3]
HTTP/3 support must be enabled on the Envoy Gateway. If first-class Gateway API
config fields are insufficient, an `EnvoyPatchPolicy` may be used as an escape
hatch to configure the QUIC listener directly.

k[envoy.proxy-protocol+2]
The Envoy Gateway must not use the PROXY protocol. It cannot be combined with
HTTP/3 on a listener, and HTTP/3 takes precedence.

k[envoy.real-ip+2]
Backends must receive the original client IP for clients connecting over IPv6.
Clients connecting over IPv4 reach the Gateway with the load balancer's address,
because the proxy pods are IPv6 targets; backends must not depend on the client
IP of those requests.

k[envoy.body-size+2]
The Gateway must reject requests whose body exceeds 50 MiB.

k[envoy.timeouts+2]
Routes must be able to specify a per-route request timeout. A route that does not
specify one must not be left on the Gateway's own default: every workload states
its timeout explicitly, and a workload that relied on an ingress default before
migrating must state the equivalent 60 second timeout.

k[envoy.mtls-passthrough+2]
The Gateway must request a client TLS certificate during the handshake for
listeners serving tamanu-meta, and must accept the connection whether or not one
is presented.

k[envoy.mtls-unverified]
Client certificates presented to those listeners are self-signed and must not be
verified against a trust anchor. The Gateway must not reject a certificate that
chains to nothing, and must not require a certificate authority to be configured
in order to request one. Authentication is performed by the backend, which pins
the certificate's subject public key.

k[envoy.mtls-header]
The Gateway must forward the presented client certificate to the backend in the
`x-forwarded-client-cert` header, carrying the full certificate, and must
overwrite any such header supplied by the client.

k[envoy.mtls-foreign-headers]
The Gateway must remove the `mtls-certificate` and `ssl-client-cert` headers from
requests to tamanu-meta. A backend that trusts either of them must only ever see
a value set by the proxy that terminated the client's TLS connection.

## Migration

k[migration.per-app]
Workloads must be migrated from Ingress to HTTPRoute one at a time. Each
workload must be validated after migration before the next begins.

k[migration.order+2]
The migration order must be: tamanu on-k8s first (timeout config), then
tamanu-meta last (mTLS, highest risk).

k[migration.staging-alias]
While a workload is migrating, the Gateway must serve it on a `gw.`-prefixed alias
of each of its domains, in addition to whatever serves the domains themselves. The
alias must carry the same routing, timeout, body-size and client-certificate
configuration as the workload's eventual primary path, so that behaviour can be
exercised without moving a production hostname. Serving the primary domains on the
Gateway must be separable from advertising them in DNS, so the Gateway can be fully
configured for a hostname before traffic is directed at it.

k[migration.cert-header-split]
While a workload that authenticates by client certificate is served by both
ingress-nginx and the Gateway, each path must reach a backend that trusts only the
client-certificate header that path's proxy sets. Both paths must be able to
authenticate clients at the same time, so that moving a hostname between them
does not interrupt authentication.

k[migration.drain]
When a workload's domains move from ingress-nginx to the Gateway, DNS for them
must be pointed at the Gateway while ingress-nginx is still serving them, and
ingress-nginx must keep serving them until the change has propagated. At no
point during the move may a domain go unclaimed by both paths in DNS.

k[migration.cleanup]
Once all workloads have been migrated, the following must be removed: the
ingress-nginx Helm release, the nginx NLB, and the `--source=ingress`
argument and corresponding ClusterRole rule from external-dns.
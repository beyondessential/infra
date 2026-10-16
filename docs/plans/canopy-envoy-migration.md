# Canopy: nginx Ingress to Envoy Gateway

## Status (2026-10-16)

Steps 1–3 of the sequencing are in the repo and applied:

- Envoy Gateway runs v1.8.3 on both the demo and main clusters.
- The canopy ClientTrafficPolicy carries `clientValidation.mode: Request`, and
  `gw.meta.tamanu.app` now sends a TLS `CertificateRequest` (with an empty CA list).
- The HTTPRoute declares `gw.meta.tamanu.app` and `gw.meta.tamanu.io` explicitly and
  carries the 60s request timeout; the BackendTrafficPolicy carries the 50Mi request
  buffer.
- `envoyStage` is unset on `canopy/prod`, so the stack is at `staging`: the Gateway listens
  only on the `gw.` names and the nginx Ingress still serves the bare domains.

No TTL change is needed: Route53 already serves `meta.tamanu.app` and `meta.tamanu.io`
with a 60s TTL.

Step 3a is applied: the Gateway routes to its own `public-server-envoy` Deployment
trusting XFCC, and its routes strip `mtls-certificate` and `ssl-client-cert`. Verified on
`gw.meta.tamanu.app`: forged nginx headers get `auth-missing-certificate`, and an
unenrolled self-signed certificate presented in the handshake gets
`auth-certificate-not-found`, so it reaches the backend via XFCC.

**Pending: verification with an enrolled device.** A test bestool build for aarch64 Linux
(static musl, no `iti` feature) talks to canopy via `gw.meta.tamanu.app` with the
tailscale path disabled, and logs `TEST BUILD: canopy mTLS via Envoy, tailscale disabled`
at startup. It is a local jj change `rylrywxm` ("DO NOT MERGE: test build…") in
`~/code/work/bestool`, not pushed; abandon it once the test is done. The binary was built
with `BINDGEN_EXTRA_CLANG_ARGS_aarch64_unknown_linux_musl="--target=aarch64-linux-gnu
--sysroot=/usr/aarch64-linux-gnu" cargo zigbuild --release --target
aarch64-unknown-linux-musl -p bestool` (sha256 `fa6441b4…d2fdba`); the plain cross build
fails to link.

The `shadow` and `drain` stages are in the repo, not yet applied. Previews of each stage
were clean.

Client IP: nginx believed client-supplied `X-Forwarded-For` because of an out-of-band
`use-forwarded-headers: true` on its ConfigMap; `k8s-essentials` now sets it `false`, so
nginx uses the PROXY protocol address (see [Migration rules](#migration-rules)). Applied and verified on
2026-10-16: a request with a forged `X-Forwarded-For` is logged with the real address by
both nginx and canopy, and canopy's `req.ip` shows real public addresses. Envoy cannot
use the PROXY protocol alongside HTTP/3, and its IPv6 targets see IPv4 clients as the
NLB's address; that gap is accepted ([K8SING](../spec/kubernetes/ingress.md#envoy-proxy)), since canopy does not rely
on the client IP.

Known hole until `drain`: the nginx path's backend trusts `mtls-certificate`, which a
client can send itself (confirmed by probe), and the certificate's signature is never
checked. Closing it on the nginx side needs a canopy change; moving traffic to Envoy,
which strips the header, closes it too.

Operational notes for the next applies:

- Local `Pulumi.prod.yaml` for `canopy` has a stale `imageTag` (`sha-059accb`); the
  deployed tag is `sha-1c7b794`. Fix it before applying, or the apply rolls the image back.
- Previews: the default kube context may be `demo`. Use a temp kubeconfig with the `main`
  context selected (`kubectl config view --raw > kc; KUBECONFIG=kc kubectl config
  use-context main`).

Next: the enrolled-device test, then step 4.

## Context

`tamanu-meta-prod/meta` is the last nginx-class Ingress in the fleet. Nothing else on the
main cluster uses `ingressClassName: nginx`, and the demo cluster has none at all. So
this workload is the whole remaining blocker on the cleanup rule under
[Migration rules](#migration-rules), and finishing it retires ingress-nginx entirely.

The Envoy side is already half-built and live. `pulumi/canopy/src/servers.ts` creates a
Gateway with listeners on `gw.meta.tamanu.app` and `gw.meta.tamanu.io`, which has been
`Programmed: True` with `gateway-tls` issued and one HTTPRoute attached per
listener; `https://gw.meta.tamanu.app/` serves 200. These staging hostnames are kept —
nothing in the repo or in DNS references them, but they are already correct for the
purpose.

What is missing is behavioural parity with the nginx Ingress, a spec that describes the
mechanism accurately, and a cutover path.

How client authentication actually works matters for all of this. Client TLS certificates
are **not** CA-signed: the backend pins on the SPKI of a self-signed certificate. nginx
requests a certificate, ignores verification entirely (`auth-tls-verify-client:
optional_no_ca`) and passes it upstream. The `auth-tls-secret` pointing at `ca-root` is
there only because ingress-nginx will not enable client-certificate request and
passthrough without *some* CA secret named — it is scaffolding, not a trust anchor.
`src/ca.ts` exists solely to satisfy that annotation: `caRootCert` has exactly one
consumer in the repo, that annotation, and `caIssuer` has none at all.

`external-dns` v0.20.0 on the main cluster runs `--source=ingress
--source=gateway-httproute` with `--registry=txt --txt-owner-id=k8s-extdns-main`, so both
the Ingress and the Gateway path are owned by the same instance and the same owner id.
The `gateway-httproute` source takes hostnames from the HTTPRoute's `spec.hostnames`,
falling back to the parent Gateway's listener hostnames when the route declares none —
which is how the `gw.` records exist today, since the canopy HTTPRoute declares no
hostnames. Making the route's hostnames explicit is what makes the cutover controllable.

## Parity gaps

Five differences between `ingress/meta` and the existing Gateway. All are fixed on the
staging path first, so what gets exercised is what eventually serves the real name. The
first one blocks everything else.

**No client certificate is requested at all.** Verified against the live endpoints:
`meta.tamanu.app` sends a TLS `CertificateRequest`, `gw.meta.tamanu.app` sends none. So
XFCC can never populate on the Gateway path — no certificate is ever offered, and the
comment in `servers.ts` claiming equivalence with `optional_no_ca` does not hold.

The cause is a version limitation. `ClientTrafficPolicy.spec.tls.clientValidation` in
Envoy Gateway v1.7.1 has exactly two fields, `caCertificateRefs` and `optional`. With no
CA referenced there is no validation context, so Envoy never sends a `CertificateRequest`;
`optional: true` only means "accept connections presenting no certificate". Referencing a
CA would make Envoy request certificates but then *verify* them, rejecting self-signed
client certificates at the handshake — worse than today, since it moves from never asking
to asking and refusing. v1.7.x has no request-without-verify mode.

Envoy Gateway v1.8 adds `clientValidation.mode`, taking `Request`, `RequireAny`,
`VerifyIfGiven` or `RequireAndVerify`, and deprecates `optional`. `Request` is documented
as "a client certificate is requested during the TLS handshake but does not require one" —
a direct `optional_no_ca` equivalent, needing no CA reference. So the fix is to upgrade
Envoy Gateway from v1.7.1 to v1.8.3 (`pulumi/k8s-essentials/versions.ts`) and set
`mode: Request`, dropping `optional`. No `EnvoyPatchPolicy` is needed, which matters
because `extensionApis` is empty in the live EnvoyGateway config and patch policies are
therefore disabled.

`ENVOY_GATEWAY_VERSION` is shared by every cluster running `k8s-essentials`. The demo
cluster carries 49 Gateways and no nginx Ingress at all, so the upgrade lands there first,
where a regression cannot take the meta endpoint with it.

**Request timeout.** Envoy's route default is 15s. The nginx Ingress carries no timeout
annotation and so runs the controller default of 60s, and the canopy HTTPRoute sets no
timeouts at all. Anything taking between 15s and 60s works today and would fail on Envoy.
Add `timeouts: { request: '60s' }` to the HTTPRoute rule, as
`pulumi/tamanu/on-k8s/src/common/ingress.ts` already does.

**Request body size.** `pulumi/k8s-essentials/ingress.ts` sets `proxy-body-size: 50m` on
the nginx controller, cluster-wide. Envoy applies no cap. Match it with a
`BackendTrafficPolicy` carrying `requestBuffer` at 50Mi, plus
`ClientTrafficPolicy.spec.connection.bufferLimit` raised from its 32768-byte default to
suit — the field documentation is explicit that the connection buffer has to be sized for
the request buffer. `requestBuffer` buffers each request fully before forwarding, which
its own documentation flags as a latency and memory cost; the cap matches nginx's
behaviour, and dropping it later is a one-field change if that cost shows up.

**Client certificate header.** Once a certificate is actually offered, the header name
still differs: nginx passes it upstream as `ssl-client-cert` (via
`auth-tls-pass-certificate-to-upstream`), Envoy as `x-forwarded-client-cert`, already
configured on the Gateway's ClientTrafficPolicy as `SanitizeSet` with
`certDetailsToAdd: ['Cert']`. `docs/tamanu-on-k8s.md` records that Envoy Gateway was
chosen for exactly this, and canopy necessarily reads `ssl-client-cert` today for the live
nginx path.

This is the whole reason the staging path exists. Client certificates are how the fleet
authenticates against the public API, not a side channel for tooling, so if the backend
does not read `x-forwarded-client-cert` then most of the public API surface fails to
authenticate. That failure is immediate and unmistakable rather than subtle, and on a
`gw.` hostname it reaches nothing that matters — which is the point of exercising it
there first.

**Client IP.** nginx uses PROXY protocol (`use-proxy-protocol: true` plus
`enable-real-ip`). Envoy cannot: the `proxy_protocol` listener filter is TCP-only and
Envoy rejects a QUIC listener carrying it, so the Gateway relies on `preserve_client_ip`
on the NLB target group instead, as the comment in `servers.ts` records. The server's
`CLIENT_IP_SOURCE=RightmostXForwardedFor` should resolve the same address either way,
since there is one proxy hop in both topologies.

HTTP/3 is enabled on the Gateway and absent from nginx. That is additive and needs no
parity work.

## Spec changes

`docs/spec/kubernetes/ingress.md` needs three edits, landing before the implementation
per the repo's spec-first rule (edit the spec, then update the code that cites it):

- The client certificate requirements ([K8SING](../spec/kubernetes/ingress.md#client-certificates)) require the client-certificate forwarding be validated
  against Envoy Gateway's `BackendTLSPolicy`. That is the wrong mechanism —
  `BackendTLSPolicy` configures TLS *to the upstream*. The requirement is about
  `ClientTrafficPolicy`: `clientValidation.mode: Request` to request a certificate without
  verifying it, and `headers.xForwardedClientCert` to forward it. It should also state that
  client certificates are not CA-signed and must not be verified against a trust anchor,
  and that the header name the backend receives differs from nginx's.
- A new item for the staging hostnames: while the migration is in progress, the Gateway
  must serve the canopy public server on a `gw.`-prefixed alias of each configured
  domain, with the same policy configuration as the eventual primary path.
- The body size requirement ([K8SING](../spec/kubernetes/ingress.md#envoy-proxy)) should name the mechanism (`requestBuffer` plus a sized connection
  buffer) rather than only the 50m figure, and the meta workload should state a 60s
  request timeout for parity with nginx.

## Gap: TCP 80 redirect

The ingress spec ([K8SING](../spec/kubernetes/ingress.md#gateway)) requires a Gateway listener on TCP 80 that redirects every request to HTTPS.
The Envoy NLB created in `pulumi/k8s-essentials/envoyGateway.ts` forwards only TCP 443 and UDP 443 (a `TCP_UDP` listener on one target group), so a request to port 80 never reaches the Gateway.
The nginx NLB handles port 80 today, which is why the gap is invisible until the hostnames move.

To close it before `drain` or `primary`:

- add TCP 80 to the Envoy service and NLB, and a target group for it;
- add the redirect listener to the Gateway and confirm it answers on the `gw.` aliases;
- check HTTP requests to a migrated hostname get a redirect to HTTPS, not a connection failure.

The ingress spec states the end state, so it stays as is.

## Implementation

### Stage config

`envoyStage` on canopy takes one of four values. Serving a hostname and advertising it in
DNS are separated by the `external-dns.alpha.kubernetes.io/controller: none` annotation,
which both the `gateway-httproute` and `ingress` sources in external-dns v0.20.0 skip.
The `gw.` aliases are served and advertised by their own HTTPRoute at every stage; the
bare domains have a second HTTPRoute, created from `shadow` on.

- `staging` (the default): the Gateway serves only the `gw.` aliases; the nginx Ingress
  serves and advertises the bare domains.
- `shadow`: the Gateway also listens on and routes the bare domains, but their HTTPRoute
  carries the ignore annotation, so DNS still points at nginx. The real hostname can be
  exercised on Envoy by resolving it at the Envoy NLB (`curl --resolve`).
- `drain`: the annotation moves from the bare-domain HTTPRoute to the Ingress, so
  external-dns retargets the records at Envoy while nginx keeps serving clients still
  resolving to it. The Ingress is updated after the route, so the names are briefly
  claimed by both and never by neither; external-dns runs the `sync` policy, which would
  delete an unclaimed record.
- `primary`: the Ingress and the nginx-side public-server are gone. The `gw.` aliases
  stay, as a name that always addresses Envoy.

Adding the bare domains to the Gateway in `shadow` makes cert-manager issue them into
`gateway-tls` while `http-tls` still holds its own copy for nginx. Two valid certificates
for one name is fine, and the DNS-01 challenge records are unrelated to the A records
being contended.

### Envoy Gateway upgrade

Bump `ENVOY_GATEWAY_VERSION` in `pulumi/k8s-essentials/versions.ts` from `v1.7.1` to
`v1.8.3`, applied to the demo cluster's `k8s-essentials` stack before the main cluster's.
This gates the client-validation change and nothing else in the plan.

### Policies

Set `clientValidation` to `{ mode: 'Request' }` in canopy's
`clientTrafficPolicyExtraSpec`, replacing the current `{ optional: true }`. No
`caCertificateRefs`, since the certificates are self-signed by design and the backend pins
SPKI itself.

Add the `BackendTrafficPolicy` (request buffer) alongside the existing Gateway, and
extend `clientTrafficPolicyExtraSpec` with the connection buffer limit. The
`Gateway` helper in `pulumi/common/k8s/gateway/Gateway.ts` already merges
`clientTrafficPolicyExtraSpec` into the ClientTrafficPolicy it creates, so only the
BackendTrafficPolicy is new; add a typed interface for it under
`pulumi/common/k8s/gateway/` following the existing pattern rather than a raw
`CustomResource`.

Add the HTTPRoute request timeout in the same change, so `staging` carries the final
policy set.

### Backend certificate header

The canopy backend reads exactly one client-certificate header, chosen per process by
`CANOPY_DEVICE_AUTH_CERT_HEADER`: `mtls` (the default) reads `mtls-certificate`, falling
back to `ssl-client-cert`; `xfcc` reads `x-forwarded-client-cert`. There is no mode that
trusts both, by design. The `public-server` Deployment sets neither, so it runs `mtls`,
and the one Deployment backs both the Ingress and the HTTPRoute.

So a single Deployment cannot authenticate both paths at once. The `gw.` path can only be
exercised, and the DNS retarget can only be done without an authentication outage, if the
Gateway routes to a second public-server Deployment and Service running with
`CANOPY_DEVICE_AUTH_CERT_HEADER=xfcc`, alongside the existing one serving nginx. At
`primary` the nginx-side Deployment goes away with the Ingress.

Each path also has to strip the headers its backend trusts but the proxy does not set:

- nginx sets `ssl-client-cert` but neither sets nor strips `mtls-certificate`, which the
  `mtls` mode reads first. A client-supplied `mtls-certificate` would therefore reach the
  backend on `meta.tamanu.app` today. Confirmed 2026-10-13: a malformed value in that
  header gets `auth-invalid-certificate` from the backend rather than
  `auth-missing-certificate`. This is independent of the migration and needs a fix in
  canopy.
- Envoy overwrites `x-forwarded-client-cert` (`SanitizeSet`) but forwards client-supplied
  `mtls-certificate` and `ssl-client-cert` untouched (confirmed the same way). The
  HTTPRoute removes both with a `RequestHeaderModifier` filter regardless of which
  Deployment it targets.

### Cutover

The public addresses of the meta names change with the retarget. Neither NLB holds
Elastic IPs, and nothing depends on meta's addresses staying fixed, so that is acceptable
here.

`shadow` → `drain` moves DNS with both paths serving throughout. Leave `drain` in place
for several TTLs (the records are at 60s) plus margin for resolvers that cache past TTL,
watching nginx's access log for meta traffic falling to zero, before `primary`.

Rollback from `drain` is setting `shadow` again. Its update order is the reverse of the
forward one (route annotated before the Ingress loses its annotation), so for a few
seconds neither claims the names; an external-dns run landing in that gap deletes the
records until the next run recreates them. Rollback from `primary` is setting `drain`,
which recreates the Ingress and nginx-side public-server unadvertised.

### Retiring nginx

Once `primary` has held, remove:

- the `ingress-nginx` Helm release and its NLB service in `pulumi/k8s-essentials/ingress.ts`;
- `pulumi/canopy/src/ca.ts` in its entirety, along with its import in `servers.ts`. It
  exists only to satisfy the nginx `auth-tls-secret` annotation, and deleting the
  Certificate takes the `ca-root` secret with it;
- the rules under [Migration rules](#migration-rules) once they have been carried out;
- `--source=ingress` at `pulumi/k8s-core/externalDns.ts:150` and the corresponding
  ClusterRole rule granting access to Ingress resources.

Nothing else in either cluster serves through nginx, so this needs no coordination with
other workloads.

## Sequencing

1. Spec edits, staged and bumped. Done.
2. Envoy Gateway v1.7.1 → v1.8.3, demo cluster first, then main. Done.
3. Parity work on the staging path. Done.
3a. Second public-server Deployment with `CANOPY_DEVICE_AUTH_CERT_HEADER=xfcc` behind the
   HTTPRoute, and a `RequestHeaderModifier` removing `mtls-certificate` and
   `ssl-client-cert`. Then verify client-certificate auth over `gw.`. Applied; enrolled-device
   verification pending.
4. `shadow`, then verify the real hostnames on Envoy via `--resolve`.
5. `drain`; wait out several TTLs and nginx traffic.
6. `primary`.
7. Retire ingress-nginx, `ca.ts`, and the `--source=ingress` argument.

## Migration rules

These rules held while ingress-nginx and the Gateway served traffic side by side.
They were removed from the ingress spec, which describes the end state, and apply until the cleanup below is done.

- An NLB fronts the ingress-nginx controller, handling TCP 80 and TCP 443.
  It is separate from the Envoy NLB and shares no target groups with it.
- ingress-nginx takes the client IP from the PROXY protocol header sent by its NLB, and does not take it from an `X-Forwarded-For` header supplied by the client.
- An IngressClass named `nginx`, backed by ingress-nginx, exists.
  It is removed once every workload has moved to an HTTPRoute.
- external-dns watches both the `ingress` and `gateway-httproute` sources.
  The `ingress` source is removed once every Ingress resource is gone.
- Workloads move from Ingress to HTTPRoute one at a time, each validated before the next begins.
  Tamanu on-k8s goes first, because it exercises timeout configuration, and tamanu-meta goes last, because it carries mTLS and the highest risk.
- While a workload moves, the Gateway serves it on a `gw.`-prefixed alias of each of its domains, with the routing, timeout, body-size and client-certificate configuration of its eventual primary path.
  Serving the primary domains on the Gateway is separable from advertising them in DNS.
- While a workload authenticating by client certificate is served by both paths, each path reaches a backend that trusts only the client-certificate header that path's proxy sets, and both paths can authenticate clients at once.
- When a workload's domains move, DNS is pointed at the Gateway while ingress-nginx still serves them, and ingress-nginx keeps serving them until the change has propagated.
  No domain is unclaimed by both paths in DNS at any point.
- Cleanup, once every workload has moved: remove the ingress-nginx Helm release, the nginx NLB, the `--source=ingress` argument of external-dns and its ClusterRole rule.

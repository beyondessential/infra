# Seedling: what the Linux host migration needs

## Context

Migrating our ad-hoc Linux hosts — Ansible plus bestool, host Caddy, host PostgreSQL,
podman quadlets — onto Seedling is planned in `docs/plans/adhoc-to-seedling-migration.md`
in the infra repo. That plan is settled. Nothing more can proceed on the infra side until the
items below exist, so this is the whole of what Seedling has to catch up on.

Everything here was verified against the Seedling tree rather than inferred; citations are
`file:line` into the seedling repo unless prefixed `infra:`. Where something is unverified it
says so.

Two structural notes that change how to read this. First, everything in `apps/` is an
example app written to exercise the runtime, and we intend to own the Tamanu and mSupply
definitions outright — so section 3 is our work to do in this repo, not a request. Second,
the migration holds the Tamanu version constant across a host's cutover, so app definitions
target env-var configuration only and need no json5 path.

## Priority

**Tier 1** blocks every production cutover.

**Tier 2** blocks production cutover on non-AWS hosts only. AWS-hosted deployments sit
behind a restrictive security group, AWS Backup snapshots and recovery that does not depend
on the host, so a tier 2 gap is survivable there. On-prem deployments — two centrals, some
fourteen external facilities, and fifteen LAN-only hosts — have none of that. Tier 2 is
therefore not a "nice to have" list: it gates a substantial share of production.

## 1. Proxy parity

`build_caddy_config` emits routing and TLS automation only
(`crates/core/src/system/caddy/config.rs`); `proxy_routes_for_vhost` emits a bare
`reverse_proxy` with a list of upstreams (`:238`). The vhosts we serve today do considerably
more. Each row below is a Caddy directive currently in production on every Tamanu host
(`infra:ansible/roles/tamanu-single-install/templates/caddy/{tamanu,upstreams,patientportal}.j2`).

| # | Requirement | Tier | Why it matters |
| --- | --- | --- | --- |
| B1 | Response compression, equivalent to `encode zstd gzip` | 1 | Frontend assets currently ship compressed. Losing it hurts most at exactly the sites with the worst connectivity |
| B2 | Upstream retries and load-balancing policy, equivalent to `lb_retries 2`, `lb_try_duration 5s`, `lb_policy least_conn` | 1 | Without retries, requests that land on a draining container 502. That happens on every rolling restart, so it is a routine failure, not an edge case |
| B3 | Per-route rate limiting | 1 | 1000/s per IP on `/api/*`, 10/s on `/api/login`. Dropping the login limit removes brute-force protection from a public health system |
| B7 | `Cache-Control` control per route: `no-cache` on `/` and `/manifest.json`, `no-store` on API responses, immutable on `/env.js` | 1 | Correctness, not just efficiency — stale shells and cached API responses both misbehave |
| B8 | A WAF hook, equivalent to `import waf*` | 1 | Enforcement is off fleet-wide today (`caddy_waf_enforce: false`), so what is required is somewhere to put one, not a WAF |
| B4 | Per-upstream `Host` header override | 2 | The frontend upstream currently receives `Host: localhost` |
| B5 | Systemd slice and `OOMScoreAdjust` control from BSL | 2 | `critical.slice` with `-500` for API workers, `elevated.slice` for sync and fhir. Nothing in Seedling exposes this today |
| B6 | Error pages served from a path inside the container (`/resources/errors/{status}.html`) | 2 | Cosmetic, but it is what users see when something is wrong |
| B9 | A path-rewriting redirect within a vhost, for `redir /v1/login /api/login 308` | 2 | Legacy client compatibility |
| B10 | HTTP/1.1 keep-alive response headers | 2 | `Connection: keep-alive`, `Keep-Alive: timeout=90` on h1 requests |

## 2. Staged ingress takeover

A capability request rather than a parity gap, and the highest-leverage item here.

**Ask.** A mode in which an app is fully installed and running — containers up, ingresses
declared, TLS provisioned, routing live and exercisable — while Seedling has *not* installed
the host DNAT rules and so takes no host traffic. The app is reachable on an address
Seedling manages. A separate, explicit operator action then says "take over": the DNAT rules
go in and traffic moves.

**Why.** On a migrating host, `:80` and `:443` belong to the incumbent Caddy until the
moment of cutover. Today the entire ingress path — TLS, hostname matching, prefix routing,
upstream health — is therefore first exercised at the instant it starts carrying production
traffic. A staged takeover proves the whole path first and leaves the flip verifying nothing
new. It converts one irreversible-feeling step into a long verifiable phase and a short
mechanical one.

**Dependency, and it is a hard one.** `observe_warm_certs` reads only Caddy's on-disk cache
(`crates/core/src/runtime/tls/state.rs:124-155`), not the runtime cert store. Certificates
the runtime provisioned by DNS-01, or that an operator uploaded with `tls certs
upload-manual`, may therefore not satisfy the barrier `apps install` waits on. If they do
not, pre-provisioning is actively worse than not bothering: a 180s stall followed by a
`cert_acquisition_failed` fault (`crates/core/src/runtime/tls/state.rs:25`). Warm-cert
observation needs to be satisfiable by runtime-managed and imported certificates.

**HTTP-01 is permanently out of scope for this.** It cannot validate while another process
owns `:80`, and the point of the staged mode is that Seedling does not own `:80` yet. Our
cert paths are DNS-01, operator import from the incumbent Caddy, and off-site issuance via
Canopy (in progress separately).

**Related gap in operator control.** We looked at approximating this with app-level
blue/green — install with the singleton workers stopped, so only stateless API and frontend
containers run alongside the old stack — and it is currently blocked: `install` starts
everything, and `stop-resource` is rejected while an operation is active
(`docs/spec/interface.md:341`). So the double-writer window is created by `install` itself
and cannot be closed from the operator side. Whatever shape the staged mode takes, being
able to bring an app up with some resources deliberately not started would help.

## 3. Tamanu and mSupply app definitions

Our work in this repo, listed here because the migration is blocked on it just the same.

| # | Requirement | Tier |
| --- | --- | --- |
| A1 | Per-server crypto key as a `secret(true)` param, written into a tmpfs volume by *static* `Volume.write` so it reapplies on container restart, with an env var pointing at the mount path. The migration copies the existing 32 bytes out of the host's `tamanu-config-key` podman secret. This key decrypts `local_system_secrets` — device key, reporting secret, sync password — so getting it wrong loses data, and does so silently: the key is touched only when an encrypted column is read, so the server starts clean and fails later | 1 |
| A2 | `DATABASE_URL` able to carry a password. Host clusters authenticate the `tamanu` role with `scram-sha-256` (`infra:ansible/roles/postgres-database/tasks/main.yml:19`), so a URL assuming socket trust cannot connect. Transitional: Seedling's own generated `pg_hba.conf` is `local all all trust`, so this can retire once PostgreSQL moves into Seedling | 1 |
| A3 | Central: bind `/api` and `/v1` on `portal_svc` to the API deployment. `apps/tamanu-central.seed.rhai:229` binds them only on `web_svc`, but the vhost we serve today routes them on the portal hostname too — so as it stands a migrated patient portal serves its frontend and then fails every API call | 1 |
| A4 | Facility: `public-hostname` genuinely optional, so the app declares no ingress at all. `apps/tamanu-facility.seed.rhai:31` marks it `.required(true)` and declares `service.ingress(...)` from it; central already guards on `is_set()`. Fifteen LAN-only hosts serve plaintext on a `.local` name and need a site ingress to carry traffic instead | 1 |
| A5 | mSupply app promoted from `msupply.seed.rhai` into `apps/`, carrying the config currently rendered to `/etc/msupply/local.yaml`, the arch-selected image, and its persistent volume. Blocks two deployments only, but blocks them completely | 1 |
| A6 | Host CA cert mount plus `NODE_EXTRA_CA_CERTS` | n/a — recorded only; no deployment currently needs it |

## 4. Questions to settle

- **Does setting a param reconcile a newly *declared* ingress into existence?** Both Tamanu
  apps guard their ingress on `public_hostname.is_set()`
  (`apps/tamanu-central.seed.rhai:211`), and `public_hostname` has no `on_change` handler. If
  setting the param after install brings the ingress up, that is a cheap approximation of a
  staged takeover available immediately. Unverified.
- **Can warm-cert observation see runtime-managed certs?** See section 2. Determines whether
  pre-provisioning helps or hurts.
- **What satisfies the warm-certs barrier on a host with no ingress at all?**
  `docs/spec/language.md:1008` documents the barrier as immediately satisfied when the
  selection contains no TLS-terminating ingresses, which is why plaintext hosts should be
  unaffected — worth confirming in practice.

## 5. Later: PostgreSQL adoption

Not needed for the initial transition — PostgreSQL deliberately stays a host package — but
it is the next phase and one requirement is worth knowing early.

`apps/postgres.seed.rhai` will be asked to **adopt an existing cluster**, not initialise
one. That already works: `initdb` is guarded on `[ ! -f /data/pg$major/PG_VERSION ]` (`:379`)
and the `data` volume is an `app.external_volume` (`:194`), so it can be a bind over a host
path. The requirement is compatibility with the cluster it adopts. The sharp edge is glibc
collation: our hosts are Ubuntu 24.04 with glibc 2.39, the app runs the Debian-based
`postgres:` image with a different glibc, and if the host cluster uses the libc collation
provider then moving the same physical files can silently change text ordering — corrupting
text indexes and missing unique violations. Seedling-native clusters avoid this by
construction (`--builtin-locale=PG_UNICODE_FAST`, `:360`); an adopted one inherits whatever
the host's `initdb` took from the ambient locale.

So: the Postgres app needs a base image whose glibc matches the clusters it will adopt, or
our own image. Also relevant, and smaller: the container runs as uid 999 (`:225`) against
host-owned files.

## What is already fine

Recorded so it does not get re-investigated or "fixed".

- **Plaintext HTTP is supported.** A site ingress with `--tls none` plus an `http`-protocol
  attachment serves plaintext with full prefix routing (`docs/spec/runtime.md:986`, `:199`).
  An ingress with no `.tls()` call is TCP passthrough (`docs/spec/language.md:450`) and is
  *not* what plaintext hosts want, since it loses path routing.
- **`.local` and single-label names already get the internal CA** automatically
  (`crates/core/src/system/caddy/config.rs:110`).
- **The DNAT flip drains; it is not a hard cutover.** The chains are NAT-type
  (`crates/core/src/system/nft.rs:53`, `:82`), traversed only for `NEW`-state packets; the
  apply is one atomic batch with no conntrack flush
  (`crates/core/src/system/data_plane.rs:51-104`); every chain is `policy: Accept` with an
  established-accept rule first. Established connections finish against the incumbent while
  new ones arrive at Seedling. The cutover cost is `apps install`, not the flip.
- **Installing Seedling with no apps registered is inert** — idle teardown removes the Caddy
  container, resolver and nftables rules (`docs/networking.md:573`), so the package can go
  onto live hosts without touching what serves traffic.
- **Volumes are host-visible** as directories or btrfs subvolumes under
  `{data_dir}/volumes/`, bind-mounted into containers
  (`crates/core/src/system/volume_store.rs:10-20`).
- **systemd socket handover is structurally impossible** and was ruled out: Seedling's Caddy
  is a DNAT'd container, never a host listener, so there is no listener to hand a socket to.
- **A legacy-bridge app** — a proxy container fronting the incumbent Caddy through an
  `external_service` — is expressible today but pointless: it requires restarting the
  incumbent to free the ports, which is the interruption it was meant to avoid.

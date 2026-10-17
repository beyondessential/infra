# Ad-hoc Linux hosts to Seedling

## Context

An "ad-hoc" Linux host is one built by `ansible/base-install.yml` plus
`ansible/tamanu-install.yml` and driven thereafter by `ansible/tamanu-upgrade.yml`. The
full shape is specified in `docs/spec/linux/`. The parts that matter here are the
ones Seedling wants to own:

- **Host Caddy** — the `caddy` deb, socket-activated, with vhosts dropped into
  `/etc/caddy/servers/` by `tamanu-single-install/tasks/config.yml`,
  `msupply-install/tasks/config.yml` and `munin/tasks/main.yml`. TLS is Caddy's own ACME:
  HTTP-01 on AWS hosts, Route53 DNS-01 where `tamanu_caddy_tls_dns_iam` is set, plus
  tailnet certs via `TS_PERMIT_CERT_UID=caddy`.
- **Podman quadlets** in `/etc/containers/systemd` — `tamanu-{type}-api@1/2`,
  `tamanu-{type}-tasks`, `tamanu-{type}-sync`, `tamanu-central-fhir-{refresh,resolve}`,
  `tamanu-frontend@a/b`, `tamanu-patientportal@a/b`, `msupply`. Upstreams resolve through
  aardvark-dns as `*.tamanu.internal`.
- **App config** — `/etc/tamanu/<version>/{production,local}.json5` with a `current`
  symlink, `/etc/tamanu/env`, and the per-host `tamanu-config-key` podman secret.
- **Boot and lifecycle** — `tamanu-boot.service` calling `bestool tamanu start`, and
  `tamanu-upgrade.yml` for version changes.

Seedling replaces all of that. It does not replace PostgreSQL, the OS baseline, Tailscale,
podman itself, munin, elastic-agent, ufw, or the `bestool-alertd` reporting path — not in
this migration.

Seedling's own moving parts, for reference: the `seedling` deb ships the daemon, the web
interface and `seedling-ctl`, keeps state in `/var/lib/seedling`, and needs podman 5.x,
nftables and (for NAT64) jool. Apps are BSL scripts; `apps/tamanu-central.seed.rhai`,
`apps/tamanu-facility.seed.rhai`, `apps/postgres.seed.rhai` and `apps/kopia-s3.seed.rhai`
already exist, and `msupply.seed.rhai` sits at the repo root awaiting promotion.

## Four constraints that shape everything

**Seedling installed with no apps is inert.** When no apps are registered the reconciler
performs an idle teardown: no Caddy container, no nftables rules, no resolver
(`seedling/docs/networking.md:573`). Installing the deb on a live host changes nothing
that serves traffic. This is what makes a fleet-wide install safe to do first.

**The `:80`/`:443` flip is atomic per host.** Seedling routes ingress by DNAT-ing
locally-destined traffic on the ingress port to its Caddy container, and site-ingress
attachments can only target app services, never a site service or a host process
(`seedling/docs/spec/runtime.md:997`). There is no per-vhost phasing and no way to have
Seedling's Caddy front a non-Seedling workload. Everything sharing `:443` on a host moves
in one step.

**An app can be fully configured with its ingress unscheduled.** DNAT rules are emitted
per *scheduled* ingress, and `seedling-ctl apps stop-resource <app> ingress <name>`
unschedules one. So registration, params, volume mappings, script validation via
`apps plan`, and image pulls all happen while `:443` still belongs to host Caddy.
Everything slow or error-prone lands outside the risky window.

**Held constant across the cutover: the Tamanu version.** A host must already be running
at or above the version floor before it can be adopted, reached through the existing
`tamanu-upgrade.yml` path and verified separately. Nothing in the cutover runs a schema
migration, so re-enabling the old units is a real rollback, and anything that breaks is
attributable to Seedling rather than to Tamanu.

## Target state of a migrated host

| Concern | Owner |
| --- | --- |
| OS baseline, toolbox, tailscale, podman, elastic-agent, ufw, ebs-volume | Ansible, unchanged |
| PostgreSQL server, `tamanu` database and roles, reporting roles | Ansible, unchanged |
| munin | Ansible, unchanged; host Caddy trimmed to only its `:4950` tailnet vhost |
| `bestool-alertd` to Canopy | Ansible; Tamanu *service* checks suppressed, host, cluster and Tamanu *DB* checks retained |
| Backup of `/var/lib/seedling` | Ansible, `bestool` definition, kopia to S3, permanently |
| Backup of the Postgres cluster | Ansible, `bestool` definition, kopia to S3, for as long as PostgreSQL is host-side |
| Ingress, TLS, vhosts | Seedling |
| Tamanu, patient portal, mSupply: containers, config, lifecycle, upgrades | Seedling |
| App-data backups | Seedling `kopia-s3` app, once PostgreSQL moves |

Removed from the host at stage 4: the quadlets, `tamanu-boot.service`, `/etc/tamanu`,
`/usr/local/bin/tamanu-run`, and `/etc/caddy/servers/{tamanu,tamanu-patientportal,msupply}`.

The PostgreSQL seam is a bind site volume over `/var/run/postgresql`, attached to the
apps' `pg-socket` external volume. PostgreSQL stays a host package; a later plan moves it
into `apps/postgres.seed.rhai`. That ordering is deliberate and argued at the end of this
document — it is the only one whose first step can be rolled back without stranding writes.

`/var/lib/seedling` becomes critical state — app definitions, param values including
secret params, daemon keys, issued certs — and gets a `bestool` backup definition
alongside the Postgres one. For `/var/lib/seedling` that arrangement is permanent:
Seedling's own kopia app is for application data, not for Seedling's own state, and
nothing should make Seedling's recoverability depend on Seedling being healthy. The
Postgres backup is host-side only for as long as the cluster is, and moves with it.

## Prerequisites

Tier 1 blocks every production cutover.

Tier 2 blocks production cutover on non-AWS hosts only. AWS-hosted deployments sit behind
a stack-wide security group admitting nothing but ICMP, TCP 80/443 and UDP 443
(`pulumi/tamanu/on-linux/src/firewall.ts`), AWS Backup snapshots of every instance and
volume, and recovery paths that do not depend on the host being healthy, so a tier 2 gap
is survivable there. On-prem deployments — two on-prem centrals, the
external facilities in five deployments, and the whole `.local` class — have none of that, and wait for the full
set.

### A. Tamanu app definition

Tamanu is dropping json5 config files. Everything the Ansible templates render is gone
from the app definition's concern — proxy trust, localisation, timezone, disk thresholds,
status reporting, auth and refresh secrets, sync credentials, the central canonical URL,
the facility id — all of it now lives in Tamanu's own internal settings, in the database,
where it crosses a cutover untouched.

Two exceptions survive, and only two: the per-server crypto key, still a keyfile pointed
at by an environment variable, and the database credentials, now carried in
`DATABASE_URL`. Both are per-host state that the migration has to lift off the running
host. The version floor exists precisely so the app definition targets that regime and
not the json5 one.

What is left below is structural: what the app definition must mount, route, and declare.

Everything in Seedling's `apps/` is an example app, written to exercise the runtime rather
than to serve our fleet. So none of these are asks of someone else's codebase: we can
change them, or take ownership of the definitions outright. Treat the A list as work, not
as negotiation.

| # | Requirement | Tier |
| --- | --- | --- |
| A1 | Per-server config key as a `secret(true)` param, written into a tmpfs volume by static `Volume.write` so it reapplies on container restart, with the env var pointing at the mount path. Adoption copies the existing 32 bytes out of the `tamanu-config-key` podman secret | 1 |
| A2 | `DATABASE_URL` must be able to carry a password. The host cluster authenticates the `tamanu` role with `scram-sha-256` (`postgres-database/tasks/main.yml:19`), so a URL that assumes socket trust auth cannot connect. The alternative is replacing that `pg_hba` line with `local tamanu tamanu trust`, which on a host also running mSupply lets any local uid connect as `tamanu`. Transitional either way: Seedling's own generated `pg_hba.conf` is `local all all trust`, reserving scram for TCP, so once PostgreSQL moves into Seedling the password stops being needed and A2 can be retired | 1 |
| A3 | Central: bind `/api` and `/v1` on `portal_svc` to the API deployment. `patientportal.j2` routes them today; `tamanu-central.seed.rhai:229` binds them only on `web_svc`, so a migrated portal serves its frontend and then fails every API call | 1 |
| A4 | The facility app must not force an HTTPS ingress. `tamanu-facility.seed.rhai:31` marks `public-hostname` `.required(true)` and declares `service.ingress(...)` from it, while central guards on `is_set()`. Hosts serving plaintext on a `.local` name need the app to declare no ingress at all, so the site ingress can carry the traffic | 1 |
| A5 | mSupply app promoted from `msupply.seed.rhai` into `apps/`, carrying what `msupply-install` writes to `/etc/msupply/local.yaml`, the arch-selected image, and the persistent volume. Blocking only for the two deployments that run mSupply | 1 |
| A6 | Host CA cert mount and `NODE_EXTRA_CA_CERTS`. No inventory sets `tamanu_extra_certs`; record it, do not build it | n/a |

### B. Seedling core

Verified against `crates/core/src/system/caddy/config.rs`, which emits routing and TLS
automation only. `build_caddy_config` contains no compression, rate limiting, retry or
load-balancing configuration, no header manipulation and no error handling;
`proxy_routes_for_vhost` emits a bare `reverse_proxy` with a list of upstreams.

| # | Requirement | Tier |
| --- | --- | --- |
| B1 | Response compression, matching `encode zstd gzip`. Losing asset compression hurts most exactly where connectivity is worst | 1 |
| B2 | Upstream retries and load-balancing policy, matching `lb_retries 2`, `lb_try_duration 5s`, `lb_policy least_conn`. Without retries, requests hitting a draining container 502 on every rolling restart | 1 |
| B3 | Per-route rate limiting, matching 1000/s per IP on `/api/*` and 10/s on `/api/login`. Dropping the login limit removes brute-force protection | 1 |
| B4 | Upstream `Host` header override; the frontend upstream currently receives `Host: localhost` | 2 |
| B5 | Systemd slice and `OOMScoreAdjust` control from BSL, matching `critical.slice` with `-500` for API and `elevated.slice` for sync and fhir workers | 2 |
| B6 | Custom error pages served from the container's `/resources/errors/` | 2 |
| B7 | `Cache-Control` rules: `no-cache` on `/` and `/manifest.json`, `no-store` on API responses, immutable on `/env.js` | 1 |
| B8 | WAF hook equivalent to `import waf*`; `caddy_waf_enforce` is false fleet-wide today, so the hook is what is required, not enforcement | 1 |
| B9 | `redir /v1/login /api/login 308`, for legacy client compatibility | 2 |
| B10 | HTTP/1.1 keep-alive response headers | 2 |

### C. Host and ops

| # | Requirement | Gates |
| --- | --- | --- |
| C1 | A certificate path that does not need `:80`. HTTP-01 is ruled out structurally, not merely inconvenient: `apps install` blocks on the warm-certs barrier and faults with `cert_acquisition_failed` after 180s, so on an HTTP-01 host the ordering is forced rather than awkward. Any of three satisfies this — Canopy off-site issuance, Route53 DNS-01 (the runtime drives DNS-01 itself, `runtime.md:1417`, so it needs no listener; `acme-dns.ts` currently mints users only for `external` servers), or importing the live leaf and key out of Caddy's storage with `tls certs upload-manual` | Stage 3 on any host with a public hostname |
| C2 | The Tamanu release that removes json5 config, expected to be v2.62 per current in-dev work. Confirm against the actual release before setting the floor | Stage 2, all hosts |
| C3 | `bestool` gains a supported way to suppress Tamanu service checks while keeping cluster and Tamanu DB checks | Stage 4, and honest Canopy status from stage 3 |
| C4 | Confirm `jool-dkms`, `jool-tools` and podman 5.x resolve on Ubuntu 24.04 arm64 from the bes-tools repo | Stage 1 |
| C5 | An Ansible-owned `seedling-ctl` client key authorised in `/var/lib/seedling/authorized_keys`. The daemon imports new entries on start, so authorising one needs a daemon restart; workloads survive that | Stage 2 |

### D. Staged ingress takeover

This one is a capability request rather than a parity gap, and it is the most valuable
thing to come out of investigating smoother cutovers.

**Ask:** a Seedling mode where an app is fully installed and running — containers up,
ingresses declared, TLS provisioned, routing live — but Seedling has *not* installed the
host DNAT rules and so is not receiving host traffic. Everything is verifiable in that
state, reachable on an address Seedling manages rather than on `:80`/`:443`. Then a
separate, explicit operator action says "take over": the DNAT rules go in and traffic
moves.

**Why it is worth building.** It splits the one irreversible-feeling step into a long
verifiable phase and a short mechanical one. Today the plan approximates this by leaving
the app's ingress unscheduled through stage 2, which works but means the ingress path
itself — TLS, routing, prefix matching, upstream health — is first exercised at the moment
it starts carrying production traffic. Under a staged takeover the entire pathway is proven
first, and the flip verifies nothing new.

**Dependency, and it is a real one.** `observe_warm_certs` reads only Caddy's on-disk cache
(`crates/core/src/runtime/tls/state.rs:124-155`), not the runtime cert store. So certs that
the runtime provisioned by DNS-01 or that an operator uploaded may not satisfy the barrier
`apps install` waits on. If they do not, pre-provisioning makes install *worse* rather than
better: a 180s stall followed by a `cert_acquisition_failed` fault. Whatever shape the
staged mode takes, warm-cert observation has to be satisfiable by runtime-managed and
imported certificates, not only by ones Caddy fetched itself.

HTTP-01 is out of scope for this permanently. It cannot work while another process owns
`:80`, and the staged mode's whole point is that Seedling does not own `:80` yet.

## Stages

Four playbooks, each independently runnable and idempotent. The staging matches the risk
profile: stages 1, 2 and 4 are reversible and dull, stage 3 is the only one with a blast
radius. Separate playbooks rather than tag-gated stages of one playbook, partly so a
cutover cannot be triggered by fumbling a `--tags` argument, and partly because notified
handlers do not fire reliably under tag-limited runs on this Ansible core.

### Stage 1: `seedling-install.yml`

Role `seedling`. Fleet-wide, repeatable, safe today.

- Assert the C4 preconditions, then install the `seedling` package from the bes-tools repo.
- Generate the Ansible-owned client key, authorise it, restart the daemon (C5).
- Enable `seedling-web-tailscale-serve.service` so the web interface is reachable at
  `https://<node>.<tailnet>.ts.net:7895/`.
- Install the `/etc/bestool/backups` definition for `/var/lib/seedling`.

No apps are registered, so the host is unchanged in behaviour.

### Stage 2: `seedling-adopt.yml`

Roles `seedling-app` (shared with greenfield) and `seedling-adopt` (migration only).
Non-disruptive: nothing is started and no ingress is scheduled.

`seedling-adopt` handles what has to be lifted off the existing host:

- Assert the running Tamanu version is at or above the floor (C2), read from the running
  containers rather than from inventory.
- Read the config key out of the `tamanu-config-key` podman secret (A1), so the material
  encrypted under it stays readable.
- Derive the `tamanu` role's password from `machine_id + salt + 'postgres' + tamanu_db_user`,
  the same seed `postgres-database` used to create it, and build `DATABASE_URL` from it (A2).

That is the whole of it. Auth and refresh secrets, sync credentials, the central canonical
URL, the facility id, timezone and localisation have all moved into Tamanu's internal
settings, so they live in the database and cross the cutover untouched — nothing derives
them, nothing carries them. What is left is the two things that unlock that database: the
key its encrypted columns are readable with, and the credentials to connect to it.

`seedling-app` handles everything derivable from inventory:

- Create the bind site volume over `/var/run/postgresql` and attach it to the app's
  `pg-socket` external volume.
- Register the app and set params.
- Create the site ingresses for alias hostnames **without attachments**. A site ingress
  with no attachments has no `(port, protocol)` and so emits no DNAT rules; attaching one
  would flip traffic immediately, and `apps stop-resource` does not cover site ingresses
  because they are not app resources. Attachment is a stage 3 step.
- Pre-pull every image the app needs, and run `apps plan` to validate script and params.
- Leave the app's ingress unscheduled and nothing started.

### Stage 3: `seedling-cutover.yml`

Role `seedling-cutover`. The only disruptive stage. Gated on C1 for any host with a public
hostname.

**The flip itself is not a hard cutover.** It drains: connections already established
against host Caddy finish there, while new connections go to Seedling. Three things compose
to give that. The DNAT chains are NAT-type (`crates/core/src/system/nft.rs:53`, `:82`),
which netfilter traverses only for `NEW`-state packets. The apply is a single atomic batch
that flushes and rebuilds the table with no conntrack flush anywhere
(`crates/core/src/system/data_plane.rs:51-104`). And every chain is `policy: Accept` with an
established-accept rule first, so there is no window in which packets are dropped.

Two consequences. First, the downtime is `apps install` — `rt.warm_certs(app).ready()` then
`rt.start(app).ready(300)`, plus the DB provision and migrate jobs
(`tamanu-facility.seed.rhai:386-394`) — and not the flip. Pre-pulling images in stage 2
removes one term from that; a staged takeover (D) removes most of the rest. Second, the
drain is *why* step 2 stops the old workers before anything else: old API processes would
otherwise keep serving for the whole drain, so two sets of writers would overlap for its
full duration rather than for an instant.

That ordering is load-bearing beyond correctness. The rollback guarantee this migration
rests on — that reverting strands no writes, because both stacks share one database — holds
only because the two never write to it concurrently. Reordering step 2 after step 4 to
shorten the window would trade that guarantee for a few seconds, which is the wrong trade
and not an obvious one from the step list alone.

1. Pre-flight: certificate present in Seedling's store, `apps plan` clean, images pulled.
2. Stop the Tamanu and mSupply units. Host Caddy and its config are left entirely alone:
   the DNAT flip in step 5 makes its Tamanu vhosts unreachable without touching them, and
   leaving them in place is what keeps rollback to a single step. Caddy will fail ACME
   renewals for those hostnames once it can no longer see `:80` traffic; that noise is
   expected and ends at stage 4.
3. Take a snapper snapshot of `/var/lib/postgresql`. The `baseline` role already installs
   snapper configured for exactly this, so the insurance is free. It is not the rollback
   anchor — the version is unchanged, so rollback does not need it — but a cutover is a
   good moment to hold a snapshot.
4. Start the Seedling app.
5. Attach the site ingresses created in stage 2, and unstop the app's own ingress. This is
   the nftables flip.
6. Verify, and leave the old stack dormant.

Verification has to exercise the two secrets, not just observe a healthy server. A wrong
`DATABASE_URL` fails loudly and immediately, so the app coming up at all covers A2. A
wrong config key does not: the key is touched only when an encrypted column is read, so
the server starts clean, serves traffic, passes health checks, and fails later on a code
path nobody drove during the cutover window.

So the check must read something out of `local_system_secrets`. On a facility, a completed
sync round against central does it — the stored sync password is decrypted to authenticate.
On a central, exercise whichever path reads the reporting secret. Confirming the app is
`Ready` is not sufficient evidence and should not be treated as such.

A failure here is a rollback, not a fix-forward: the old stack is still dormant and intact,
and every minute spent debugging is a minute of divergence in a database the old code could
otherwise still serve.

### Stage 4: `seedling-decommission.yml`

Role `seedling-decommission`. Run per host once the cutover has proven itself.

- Remove the quadlets, `tamanu-boot.service`, `/etc/tamanu`, `tamanu-run`, and the Tamanu
  and mSupply Caddy vhosts.
- Trim host Caddy to the munin vhost alone.
- Write the marker that gates the legacy playbooks, and suppress alertd's Tamanu service
  checks (C3).

The `tamanu-config-key` podman secret is **not** removed. Once `/etc/tamanu` is gone it is
the only copy of the key outside Seedling's param store, and the data it protects outlives
every other artefact on this list. Decommissioning removes the old *runtime*, not the old
key material.

Host Caddy is deliberately not purged. munin is served by it as a file server on `:4950`
on the tailnet (`munin/templates/munin-server.j2`), which never collides with Seedling's
`:80`/`:443` DNAT. Retiring Caddy entirely means giving munin another home, and that is
not worth coupling to this work.

## Greenfield

Seedling is also the target for new Linux deployments. Those run `seedling-install.yml`
then `seedling-adopt.yml`, ending with a plain `apps install` instead of a cutover: no
legacy state to read, no old stack to stop, no decommission. `seedling-app` is the shared
role, and it is the reason adoption is split from cutover — `seedling-app` owns everything
derivable from inventory, `seedling-adopt` owns everything that has to be lifted off a
running ad-hoc host.

## Ansible's role after migration

One-shot handoff. Once a host is cut over, Ansible does not converge Seedling-side state;
operators own apps and params through `seedling-ctl` and the web interface. Inventory
keeps only host-level variables and whatever stages 2 and 3 seed.

The migration needs no inventory edits, and the mapping is short, because everything that
described the deployment to Tamanu is now internal to Tamanu. What remains describes the
deployment to *Seedling*: which image to run, which hostnames to route, and the two
secrets that reach the database.

| Inventory | Param |
| --- | --- |
| `tamanu_version`, at or above the floor | `version` |
| `public_hostname` | `public-hostname`, which is what the app declares its ingress from; unset on hosts serving plaintext |
| `patient_portal_fqdn` | `patient-portal-fqdn`, likewise an ingress declaration |
| `tamanu-config-key` podman secret | config key param (A1) |
| `machine_id + salt + 'postgres' + tamanu_db_user` | the password inside `DATABASE_URL` (A2) |

Alias hostnames become site ingresses rather than params. A deployment serving an alias
alongside its primary name attaches it with `--to tamanu/web`; one that redirects an old
hostname uses `attach-redirect --code 308`. The tailnet vhost is replaced by attaching the
Tailscale-discovered site ingress to `tamanu/web`.

Hosts serving plain HTTP on a `.local` name — `public_hostname: tamanu-iti.local`, 15
hosts across 9 deployments — declare no app ingress at all. They get
`ingresses site create <name> --tls none` in stage 2 and
`attach --port 80 --protocol http --to tamanu/web` in stage 3. Because the attachment's protocol is
`http` rather than raw TCP, prefix routing across the service's `/api`, `/v1` and `/`
bindings still applies (`seedling/docs/spec/runtime.md:199`), which an ingress with no
`.tls()` call would not give. These hosts need no certificate, so C1 does not gate them.

## The legacy gate

`ansible/roles/common` is a dependency of `tamanu-single-common`, `msupply-common`,
`caddy` and `bestool`, so a single detection task there makes the fact available
everywhere it is needed. It stats the stage-4 marker and sets `seedling_managed`.

- `tamanu-single-common` and `msupply-common` assert `not seedling_managed`, so
  `tamanu-install.yml`, `tamanu-upgrade.yml`, `tamanu-frontend-upgrade.yml` and the
  mSupply roles refuse to run on a migrated host. Overridable with
  `dangerously_ignore_seedling`, matching the existing `dangerously_leave_ufw_alone`
  convention.
- `bestool` uses the fact to suppress Tamanu service checks while keeping the cluster and
  Tamanu DB checks (C3).
- `caddy` uses it to switch to munin-only mode.

## Rollback

Rollback is one step at any point before stage 4: unschedule the app's ingress, detach the
site ingresses, stop the Seedling app, start the old units. Caddy's config was never
touched, so it resumes serving as soon as the DNAT rules are gone. This holds after the
flip as well as before it, because the Tamanu version and therefore the schema are
unchanged and the quadlets come back up against the same database.

Rollback stops being cheap only after stage 4, which is why stage 4 is a separate
playbook run per host on operator judgement rather than a tail of the cutover.

## Rollout order

Ordered by risk profile, which means by how recoverable a bad cutover is rather than by
how few prerequisites a host needs.

1. **Pilot: dedicated AWS environments.** Spun up for the purpose, built ad-hoc through
   the existing Pulumi and Ansible path, then migrated — so the pilot exercises the whole
   migration rather than a greenfield install. Downtime is free on a throwaway env, so the
   pilot can absorb an issuance window — stop Caddy first, which frees `:80` and lets
   HTTP-01 work in the forced ordering C1 describes — and so does not wait on C1. Demo hosts
   can serve the same purpose where convenient, though the demo estate is being consolidated
   separately.
2. **AWS-hosted production, single vhost.** Tier 1 and C1. Tier 2 gaps are accepted here;
   the security group, AWS Backup and host-independent recovery carry the risk.
3. **On-prem production.** Tier 1, tier 2 in full, and C1. The two mSupply deployments
   additionally need A5.
4. **The `.local` class last.** These need no certificate and so clear C1 trivially, but
   they sit behind the most fragile networks in the fleet, remote hands are hardest to
   arrange, and a rollback needs someone who can actually reach the box. Cheap
   prerequisites do not make them cheap to recover, and recoverability is what orders this
   list. Tier 1, tier 2 in full, and A4.

A4 and A5 are tier 1 for a class rather than for the fleet: A4 blocks only the `.local`
hosts and A5 only the two mSupply deployments, so neither holds up the stages above them.

## Status: waiting on Seedling

Nothing on the ops side proceeds until Seedling has what this plan needs: the tier 1 and
tier 2 proxy parity of section B, the staged ingress takeover of section D, and the app
definitions of section A. Those are collected for the Seedling side as
`docs/plans/seedling-requirements-for-linux-migration.md`, which is written to be moved into
that repo and iterated on there.

Stage 1 is the exception and does not wait: installing the package registers no apps, so the
reconciler idles and the host is unchanged. It can go out fleet-wide whenever C4 is confirmed.

When the Seedling work lands, re-analyse rather than execute from here directly. A staged
takeover in particular changes stage 2 and stage 3 enough that their step lists should be
rewritten against what actually shipped, not adapted to it.

## Out of scope: moving PostgreSQL later

Not part of this plan — PostgreSQL stays a host package throughout. Recorded because the
shape of the eventual move bears on decisions taken here, and because two findings are
cheaper to write down now than to rediscover.

**Why the workloads move first, and Postgres later.** All three orderings — workloads then
Postgres, both together, Postgres then workloads — are mechanically possible. Seedling's
volumes are plain directories or btrfs subvolumes under `{data_dir}/volumes/`, bind-mounted
into containers (`crates/core/src/system/volume_store.rs:10-20`), and the Postgres app
exports its socket as one of those (`apps/postgres.seed.rhai:197-199`), so the socket is
host-visible and the existing quadlets could be remounted onto it. Seedling's Postgres
trusts the local socket, and trust ignores a supplied password, so the old quadlets' config
would even keep working untouched.

Workloads-first wins on reversibility, which is the property that matters for the step
taken while Seedling is least proven. Under this ordering both stacks share one database,
so rolling back the flip strands no writes: stop the Seedling app, start the quadlets,
nothing is lost. Any ordering that moves Postgres first or moves both together has
workloads writing to the new cluster, so rolling *that* back strands every write since the
handover. Put differently: ordering decides what Seedling is trusted with first, and this
ordering trusts it with serving requests — recoverable, data untouched — rather than with
the database and its backups.

Postgres-first does have one real advantage, which is that A2 would never exist: the
`DATABASE_URL` password requirement is there solely because the host cluster uses
`scram-sha-256`, and the `pg-socket` bind-volume seam would never be built either. Both are
throwaway work under this ordering. It is disqualified anyway because it breaks backups on
day one — bestool backs up Postgres as the superuser over the local socket using peer auth
(`postgres/tasks/access.yml:73`) and Seedling's generated `pg_hba.conf` has no peer line —
which forces the database's backup onto Seedling's least-exercised path at the same moment.
It would also mean editing the legacy quadlet roles to remount the socket, investing in code
being retired, and leaves boot ordering between the Postgres app and `tamanu-boot.service`
undefined.

Both-at-once collapses two maintenance windows into one, which is worth something at busy
sites where coordination cost is per-window rather than per-minute. Against it: no host can
move until the union of every prerequisite lands, including the Postgres compatibility work
below, so all benefit is delayed; and rollback becomes both compound and lossy. Worth
revisiting for small sites, where one slightly longer window may beat two rounds of
scheduling.

**Physical replication does not fit; a btrfs reflink cold-copy does.** The instinct that a
containerised standby alongside the host primary would be too much load is right, but the
binding resource is disk, not CPU or IO. On one production central the logical data
directory is 108.3 GiB against 90.9 GiB free, so a physical standby — a second full copy on
the same filesystem — is marginal at best with no slack for catch-up WAL, and it fails worst
on exactly the hosts that are hardest to take down. Load on that host is 0.13/0.42/0.71
across 4 cores; compute was never the problem.

The cold-copy path verifies clean. `apps/postgres.seed.rhai:379` guards `initdb` on
`[ ! -f /data/pg$major/PG_VERSION ]`, so the app adopts existing data rather than
initialising over it. Its `data` volume is an `app.external_volume` (`:194`), so it can be
a bind site volume over a host path. And `/var/lib/postgresql` is its own btrfs subvolume
(`@postgres`, `compress=zstd:6`) — a separate EBS volume as well on legacy-layout hosts —
so a snapshot or same-subvolume reflink copy can be handed to Seedling as the app's data
volume directly. Downtime is two process restarts, independent of database size.

**Copy or bind — a trade-off, not a strictly better option.** Handing over a *copy* keeps a
pristine original, so a collation or on-disk-format problem damages only the copy; but once
the containerised server takes writes, reverting to the original strands them. Binding the
app's data volume at the *existing* data directory instead makes reversion lossless in both
directions — stop one server, start the other, same files — at the cost of having no
untouched original if something does go wrong, and it requires that the two servers never
run at once. Which is right depends on whether divergence or corruption is the greater fear,
and that in turn depends on how confidently the compatibility question below has been
settled: a verified-compatible cluster argues for the bind, an unverified one for the copy.

**The compatibility requirement that creates.** The Postgres app must be compatible with
the cluster it adopts, and the sharp edge is glibc collation: the host is Ubuntu 24.04 with
glibc 2.39, the app runs the Debian-based `postgres:` image with a different glibc. If the
host cluster uses the libc collation provider, moving the same physical files can silently
change text ordering — corrupt text indexes, missed unique violations. Every physical method
shares this, replication included; only logical methods rebuild indexes. Seedling-native
clusters dodge it by construction (`--builtin-locale=PG_UNICODE_FAST` or `--locale=C`,
`:360`), while an adopted one inherits whatever the host's bare `initdb` took from the
ambient locale. Since the app definition is ours to own, the fix is ours too: pin a base
image whose glibc matches, or build our own Postgres image. This is a requirement to
specify, not a blocker.

Two things needing measurement rather than reasoning. No real cluster's actual collation
has been checked — that needs a query. And the container runs as uid 999 (`:225`) against
host-owned files, so adoption implies a recursive `chown` over ~108 GiB, which rewrites
inodes rather than data but is not free; uid matching or an idmap may avoid it. Data
checksums are not a divergence: PG18 enables them by default and the fleet reports them on.

**Cheapest way to settle all of it:** on a demo host, query `datcollate` and
`datlocprovider`, compare `ldd --version` between host and container, then perform a reflink
adoption and run `bt_index_check(heapallindexed => true)` across the btree indexes. That
surfaces the collation, uid and on-disk-format questions together, on a box where being
wrong costs nothing.

**The alertd seam is what the PG move actually threatens.** `bestool-alertd` reaches
Postgres as a read-only role over the socket using peer auth with a `pg_ident` map from root
(`postgres/tasks/monitoring-user.yml:35`+). Seedling renders its own `pg_hba.conf` with no
peer line and no ident map, and the socket becomes a container volume — so `db_connect`,
`migrations`, `pg_tuning`, `pg_checksums` and the Tamanu-schema checks all lose their
connection. This plan works to keep those checks alive across the *ingress* migration; it is
the *PostgreSQL* migration that breaks them.

TODO: work out how `bestool-alertd` health-checks a Seedling-run Postgres at all. The
options are not obviously equivalent — grant alertd's role a path in through Seedling's
generated `pg_hba.conf` and expose the container's socket back to the host; connect over
TCP with a password instead of peer auth, losing the property that there is no credential
to keep in sync; or move the checks inside Seedling and have it report them. That last one
overlaps with Seedling's own Canopy integration, so the answer may fall out of that work
rather than needing its own. Settle it before the PostgreSQL migration is planned, not
while it is being executed.

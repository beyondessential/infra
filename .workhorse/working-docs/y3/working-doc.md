---
status: draft
---

# Scaling Tamanu to zero

Working out what is needed to turn scaling Tamanu to zero into a supported feature: an idle deployment (API, sync, Postgres) drops to near-zero compute and wakes on real demand.

Seeded from the "Scale-to-zero Tamanu" artifact (4 Nov 2026). Code references and prices below come from that artifact and have not been re-checked against the code.

## Goal

- Working-hours deployments save roughly 60% of compute, and demo, dev and prototype deployments 90-95%. 24/7 sites (an emergency department) run as today.
- Waking and sleeping follow actual use, not fixed hours.
- Only cloud and Kubernetes deployments benefit. On physical servers the saving is marginal power.
- Strategic point: production moves to Kubernetes today only when volume justifies it. If idle compute largely disappears, every production that data sovereignty allows could move.

## Behaviour

### Every server (idle sleep)

Replaces the time to live. Each server (central, and each facility server) has its own supervisor and sleeps and wakes on its own. A deployment is the set of its servers, and its servers can be in different states.

- Every server sleeps by default, production included. A setting opts a server out and keeps it always on.
- A server sleeps after 30 minutes with no activity.
- Activity is all traffic through the server's Caddy, except health probes, monitoring checks and the "anything for me?" flag check.
- A facility's sync checks central's flag first, and opens a session only when the flag says there is something to pull or the facility has something to push. A sync session counts as activity at central, so a facility that has nothing to say does not keep central awake.
- A request to a sleeping server starts the wake.
- Browser paths get a "waking up" splash page while it wakes.
- API paths (`/api`, `/v1`) get `503` with `Retry-After` and are not held open, since a wake can take minutes.
- Mobile devices check the flag before syncing. A device with nothing to push and nothing to pull does not wake central, and the check does not count as activity.
- A device with local changes to push wakes central.
- While central sleeps, the supervisor serves logins and token refreshes for known users and devices. What those write (new refresh tokens, device last-seen, login attempts including failures, so lockout counts stay right) is handed to the database on wake, with the access tally.
- The flag is global per central: the highest tick of a real data change. A device needs to sync when that tick is above its own pull cursor, and a device that has never synced always does. No separate counter is kept. Per-device precision can come later if wanted.
- The supervisor keeps a tally of the accesses it handled while the database was down (flag checks, for example, by device), and hands it to the database when it wakes. Counts of devices seen and similar records stay accurate across sleep.
- A wake on update (rollout) stays, so migrations and hooks have a database.
- A deployment that never sleeps is surfaced by an alert, because the TTL no longer stops it.

### Facility

- A small always-on supervisor beside the facility keeps API, web and Postgres down while there are no user requests and nothing to pull.
- Central answers "is there anything for me?" cheaply, before a sync session starts.
- The first request of the day gets a "waking up, about 5 minutes" page. The supervisor starts local services, pushes local changes (none after a clean shutdown), pulls what central has queued, then lets the user in.
- A facility wakes central only when it has data to push, someone logs in, or its flag is set.
- Sleep is the default and sites opt out. The opt-out has three purposes: testing, troubleshooting and bugs, and quiet facilities that still need very fast access to patient data at odd hours. "Very fast" means instant, so any site that cannot tolerate a wake opts out entirely; the supervisor does not serve data while waking. Tamanu tolerates internet outages, so poor connectivity is not a reason.

### Central

- When facilities go quiet, sync settles and stops. With no useful sync work, central's database is not needed.
- Opening central's admin interface wakes it. This is simpler than a facility wake because sync need not start.
- Central sleeps again when no flags are set, no sessions are open and no admin requests have arrived for a while.

### Cross-wake

- Everything asleep overnight. Facility A wakes, a patient is entered, it pushes, which wakes central.
- Central's supervisor marks every other facility as having changes pending. B's supervisor polls, sees its flag, wakes only its sync process, pulls, and sleeps again. A pull clears that facility's flag.
- Facilities (and mobile, if wanted) poll the supervisor, not the API, so a "no" costs nothing and wakes nothing.

### Timed wakes and catch-up

- The supervisor wakes the tasks process for scheduled reports, vaccination reminders and the overnight clinical generators.
- Hourly and other maintenance tasks catch up on wake. `node-schedule` skips runs missed while down, so this needs last-ran bookkeeping.
- FHIR refresh jobs queue whenever data changes, so a woken central starts with a backlog.
- Tamanu servers do not push a status any more (the status task is dead code), so a sleeping server has no heartbeat to miss.

## What keeps Tamanu awake today

- Facility `SyncTask` runs every minute and at startup, with no pre-check. Central only offers session-based routes.
- An empty session is costly on central: a permanent session row, advisory-lock and tick-tock transactions, `CREATE TABLE AS` and snapshot tables, a `VACUUM ANALYZE`, then drops.
- `SyncLookupRefresher` runs every 20 s and writes whether or not anything changed, so the global tick keeps climbing and cannot be the idle signal.
- The facility keeps a permanent socket.io connection to central. Central has no way to make a facility sync.
- Mobile syncs with central every 5 minutes, or every 10 s after an urgent trigger, with no foreground check.
- Facility web logins try central first, so every login wakes central.
- No process records when it last served a request or whether it has work in flight.

Missing today: a cheap "anything for me?" check, a way for central to wake a facility, and an idle measure.

## Implementation options

### Postgres

Every option sleeps only at zero client connections, so the app has to go quiet first. With a supervisor in charge, plain CNPG hibernation (already used for TTL sleep) is enough.

| Option | Verdict |
| --- | --- |
| CNPG declarative hibernation | Removes pods, keeps volumes. About 20 s to wake, plus node time. Preferred |
| Xata cnpg-i-scale-to-zero | Sidecar hibernates on idle but does not wake. Possible safety net, v0.1.x |
| Xata platform | Wakes on connect, but heavy and not suited to a single instance |
| Aurora Serverless v2 (min 0 ACU) | Only managed option that scales to zero. Pauses blocked by open connections, RDS Proxy, logical replication. Data leaves EKS |
| Aurora DSQL | Out: no triggers, PL/pgSQL, sequences or extensions |
| Neon self-hosted | Out: scale-to-zero only in the hosted control plane |
| OrioleDB, ZeroFS | Out: not production-ready, and they do not provide a sleep mechanism |

Constraint: no multi-tenant database SaaS for patient data. Single-tenant AWS offerings are acceptable if the pricing works.

Cost per database per month (US East, always on vs paused outside 10 h/day): Aurora at 1 ACU about $88 vs $36, at 0.5 ACU about $44 vs $18, CNPG on half an m8g.large about $33 vs $14 (only if Karpenter frees the node). CNPG on shared Graviton is already cheaper than Aurora before sleeping, and our renderer runs at least 2 instances, which doubles the CNPG rows. The saving per database is tens of dollars; the prize is the app pods and nodes.

### Sleep and wake sequence

1. Sleep: supervisor sees no requests, no open sessions, no flags. It scales app pods to zero, then sets `cnpg.io/hibernation=on`.
2. Asleep: volumes stay, so the cost is EBS (under a dollar a month at defaults). Karpenter removes emptied nodes after consolidation (30 min on spot).
3. Wake: `hibernation=off`, CNPG recreates pods on the same volumes in the same zone, clean start, then app scales up.
4. Expected: about 20 s for the database, plus 1-2 minutes if Karpenter launches a node (an estimate), plus Tamanu cold start. Inside the splash budget.

### Supervisor and actuator

Two small always-on services in one pod, joined by an HTTP contract.

- **Supervisor (Tamanu):** decides when. Knows sync flags, sessions, user activity, task schedules, the splash page. SQLite state. Knows nothing about Kubernetes, CNPG, Envoy or systemd.
- **Actuator (infra):** decides how. Knows namespace, Deployments, CNPG hibernation, HTTPRoutes, RBAC. Found by one environment variable (for example `TAMANU_ACTUATOR_URL`). On Linux it could drive systemd units behind the same contract.

Contract:

1. Desired state, not commands: `PUT /v1/state`, `GET /v1/state`. Retries cannot leave things half-woken.
2. Per part: `database`, `api`, `web`, `sync`, `tasks`, `fhir`. Cross-wake needs "sync and database up, API and web down".
3. Asynchronous: `PUT` returns at once, the supervisor polls until every part is `ready`.
4. Versioned (`/v1`), as an OpenAPI file in the Tamanu repo that infra implements. The actuator supports every version in use by deployed releases.
5. The actuator does not change routes. Caddy is the permanent backend behind Envoy and handles requests while parts are asleep (see Caddy below).

Caddy's access log gives the supervisor the time of the last request, so the app needs no activity endpoint of its own. Requests that run long (imports, reports) must count as activity while in flight, not only when they finish; Caddy's metrics or a log entry at request start would cover that. To check.

One actuator per deployment (namespaced `tamanu-ttl` service account, no cross-tenant permissions) versus one per cluster: start per deployment.

### PGlite spike results

Run against a scratch PGlite 0.5.15 served over its socket (`@electric-sql/pglite-socket`, loopback only), using the built Tamanu packages from a local checkout. The build was from June, so it covers the migrations up to early July; the checkout is newer.

Works:
- Tamanu's own `initDatabase` connects through Sequelize and registers all 161 models.
- The baseline schema (143 tables with triggers and PL/pgSQL) loads in under a second. All 113 migrations then apply through Tamanu's own migrator in about 2.6 s. Tamanu's three extensions (`fuzzystrmatch`, `pgcrypto`, `uuid-ossp`) all ship with PGlite.
- Central's real `login` and `refresh` request handlers, called from the built code with a stubbed request and response, pass every case tried: new device (a serializable transaction plus an advisory lock), known device, wrong password (a failed-attempt row is written), access token verification, and refresh token rotation. Login wrote to `devices`, `refresh_tokens` and `user_login_attempts`, which is the hand-over set on wake.

Constraints found:
- PGlite is one session. A second connection shares the first's transaction and session state, so the supervisor must use one connection at a time (pool of one) and nothing may open a second connection inside a transaction. Tamanu's baseline migration does exactly that, so it deadlocks on an empty database. The schema has to be preloaded (a schema dump from the source, which is the plan anyway) and the migrator only ever sees a database that already has the baseline.
- A schema dump blanks `search_path` for the session; load it, then reset it.
- A new sync-client device needs a registration quota on its user, a Tamanu rule that applies here as anywhere.

Cost, measured in four steps. The first figures are PGlite alone on a trivial database; the last is the realistic one.
- Creating a database in a process (which runs `initdb`) leaves it at roughly 500 to 740 MB resident, whatever the schema size or whether the data directory is on disk, and the memory is not returned when the instance closes.
- Opening an existing data directory skips `initdb` and takes about 80 ms and roughly 300 MB resident.
- `initialMemory` makes no difference at 128 MB and above. It cannot go lower: the WebAssembly module declares 2048 pages (128 MB) up front, and smaller values fail to link.
- Under a hard cgroup memory limit with swap off (`systemd-run --user --scope -p MemoryMax=...`), PGlite alone on a trivial database runs at 256 MB and is killed at 224 MB. A soft limit (`MemoryHigh`) of 160 MB stalled it.
- The realistic case, with PGlite on an existing data directory holding the full migrated schema (169 tables, 66 MB on disk) and Tamanu's login code in the same process, passes every login and refresh check down to a 416 MB limit and is killed at 384 MB. Peak resident size was 470 to 490 MB. That used the full schema from running the migrations, which the supervisor would not do.
- The same test on a copy pruned to the tables login reads, which is what the supervisor would hold, behaves the same: all 7 checks pass at 448 MB and the process is killed at 384 MB. Ten tables were enough: `users`, `devices`, `refresh_tokens`, `roles`, `permissions`, `facilities`, `settings`, `user_login_attempts`, `user_facilities` and `local_system_facts`, plus the `logs` schema that the audit triggers write to. Starting from an obvious set, one run's missing-relation error named the last table, so the allowlist guard in Q15 does fail loudly as designed. Pruning does not shrink the data directory (60 MB against 66 MB), because the cluster itself is most of it, and the schema size does not move the memory floor.

So a process that can serve logins needs roughly 400 MB at stock settings, about half PGlite and the rest Tamanu's code and Sequelize, and a Kubernetes memory limit does not shrink it, it only kills the process below the floor.

Memory, what reduces it:
- PGlite runs stock Postgres settings inside its WebAssembly memory (`shared_buffers` 128 MB, `max_connections` 100, `wal_buffers` 4 MB). Its `startParams` option replaces PGlite's default argument list, so passing the same list plus `-c shared_buffers=8MB -c max_connections=10` cut PGlite's anonymous memory from 258 MB to 119 MB. Going below 8 MB made no further difference. With that setting the whole login process passes all checks at a 320 MB cgroup limit and is killed at 256 MB, against 416 MB and 384 MB before.
- Breakdown of anonymous memory at that setting: Node and PGlite's JavaScript 18 MB, PGlite open 157 MB (about 140 MB of it PGlite), requiring `@tamanu/database` adds about 147 MB (126 MB of JavaScript heap), registering the 161 models adds about 49 MB. Tamanu's code is now the larger share.
- `--max-old-space-size=128` took about 40 MB off (323 MB to 286 MB at the end of init, not re-run under a cgroup limit). `--jitless` breaks PGlite's WebAssembly, and a single-threaded GC flag did not start.
- A real Postgres 18.6 tuned small, in the same cgroup as Node and Tamanu's login code, passes all 7 login and refresh checks down to a 160 MB limit and is killed at 152 MB. That is about half PGlite's tuned floor (256 to 320 MB) and a third of its stock floor (about 400 MB). Settings used: `max_connections=5`, `shared_buffers=1MB`, `work_mem=1MB`, `maintenance_work_mem=1MB`, `temp_buffers=800kB`, `wal_buffers=32kB`, `wal_level=minimal` with `max_wal_senders=0`, `max_wal_size` and `min_wal_size` at 32MB, `autovacuum=off`, `max_worker_processes=0` and parallel workers off, `io_method=sync` (PostgreSQL 18's default spawns I/O workers), `track_activities` and `track_counts` off, `fsync=off`. The server is six small processes with a combined proportional size of about 10 MB, or 55 to 60 MB as the cgroup counts it, which includes reclaimable page cache from the data directory. Node with Tamanu's code is then the larger part: about 190 MB peak resident, about 125 MB anonymous.
- Loading only login's own pieces instead of the whole model barrel barely helps. Requiring just the eight model files login reads already costs 153 MB of anonymous memory against 170 MB for everything, because the models pull in about 2,100 modules between them: all of `date-fns` (617 modules), `zod`, `lodash`, `moment-timezone`, `sequelize`, and, through `@tamanu/shared`, PDF, barcode and layout libraries (`@react-pdf/*`, `fontkit`, `brotli`, `yoga-layout`, `jsbarcode`, React). Replacing the PDF, barcode, layout and React packages with inert stand-ins (a stub loader, as a supervisor-specific bundle would alias them) keeps all 7 login checks passing and saves only about 13 MB of anonymous memory (191 MB to 178 MB). The cost is spread over the general import graph, not a few heavy packages.
- Re-measured on current Tamanu `main` (commit 62bcf8604d, 4 Nov), in a clean clone with fresh dependencies, running the source directly (the earlier figures above came from a June build of the packages). Postgres, the runtime and Tamanu's login code in one cgroup with the ten-table copy: all 7 login and refresh checks pass at 192 MB on Node with `tsx` and are killed at 176 MB; on Bun they pass at 168 MB and are killed at 160 MB. The same ten tables are enough on current `main`. Unlimited runs look much further apart (Node 242 MB anonymous, Bun 148 MB) but Node sizes its heap from the cgroup limit, so with the limit set equal to the request, as the supervisor needs, the gap is about 20 MB, not 95 MB. `tsx` compiling TypeScript on the fly costs Node some memory; a pre-compiled bundle would drop it.
- Runtime comparison, with only third-party packages (no Tamanu code): after loading Sequelize, pg, zod, yup, validator, lodash, es-toolkit, date-fns, moment-timezone, jose, winston and semver, Node holds 121 MB of anonymous memory and Bun 1.4.4 holds 38 MB. Most of the gap is `date-fns` plus `moment-timezone`, about 72 MB on Node and 4 MB on Bun. Run with Tamanu's code, the floor difference shrinks to about 20 MB (see above). Bun runs Tamanu's login and refresh code unchanged once the package exports are fixed (below), including the `bcrypt` native addon, Sequelize and pg. What remains is a support question for a component that must never die: Tamanu supports its source only on Node.
- Package exports. Tamanu's workspace packages declare `"exports"` targets that are directories or extensionless paths (`".": "./src"`, `"./*": "./src/*"`), which only resolve under `tsx`'s lenient resolver; plain Node resolved 5 of the 182 distinct `@tamanu/*` specifiers used in the repo and Bun 129. A generator, `scripts/generate-package-exports.mjs` (with `--check`), rewrites each package to explicit file targets for every subpath in use while keeping its existing surface and wildcards; after it Node resolves 181 and Bun 181 (the last is a mention in a doc comment). All 13 main entry points import under both Node with `tsx` and Bun, and 637 tests across `utils`, `constants`, `settings`, `shared`, `errors` and `api-client` pass. It is committed on a local branch, `y3-compliant-package-exports` (commit 8352a69dc7), in the clean clone at `/tmp/y3-tamanu`, not pushed. Node itself still cannot run the source without `tsx`, because relative imports inside each package are extensionless; fixing that is a much larger change and is not needed for Bun or a bundle.
- Tight settings have a cost to design for: the lock table is small, so dropping or altering many tables in one transaction fails with "out of shared memory" (150 table drops did). The sleep-time copy should create and fill tables one statement at a time, not in one big transaction. Loading the schema needs no migrator, only `psql` or equivalent.
- Real Postgres needs the contrib extensions Tamanu uses (`uuid-ossp`, `fuzzystrmatch`, `pgcrypto`) installed in the image, and runs as a second process in the supervisor's container.

Not covered: a copy of real data volumes and the copy mechanism itself (schema dump plus data from the source database); the database-backed permissions path (the config used hardcoded permissions); central's Express middleware (only the handlers were called); production mode (the version compatibility check was bypassed in development mode); the current source rather than a June build; password hashing at production cost (the spike used a cheap cost so logins took about 40 ms).

### Caddy as the supervisor's front

Decided (Q16): every Kubernetes deployment gets a Caddy in front of its API and web. Routes then never change: Caddy is the permanent backend, serves the splash page or `503` and calls the supervisor when the app is down, and its access log is the idle signal. The K8STSD rule that hibernation must not change routes survives as written.

Routing is defined in three places today: the Linux Caddy templates (about 270 lines of Jinja), the Kubernetes Gateway routes (`renderer/src/gateway.rs`) and the frontend image's own Caddy. Putting all traffic through one Caddy gives Kubernetes the same request path as Linux and Windows, and fixes that drift.

- Tamanu owns the server block (paths, upstream roles, rate limits, error and splash pages, supervisor), shipped per release as a snippet or image.
- Infra owns TLS, certificates, hostnames and upstream discovery, plus Envoy above it on Kubernetes (reduced to TLS and one route per hostname).
- Caddy already gives most wake mechanics: `lb_try_duration` holds requests, `handle_errors` serves the splash page and calls the supervisor, and access logs and metrics give last-request time.
- Linux Caddy uses non-stock modules (`rate_limit`, WAF). The third-party builds repo already compiles Caddy with them.
- Pod: Caddy, supervisor and actuator in one single-replica pod on on-demand or system capacity, since a spot reclaim there takes the server offline.
- Keep Envoy's timeouts at least as long as Caddy's.
- No saving on Linux and Windows; the value there is shared routing.

### Kubernetes today and what exists

Reusable: the TTL hibernate CronJob and `tamanu-ttl` service account (`pulumi/tamanu/on-k8s/src/schedule.ts`), the suspended `wake` CronJob (`renderer/src/wake.rs`, `docs/sops/wake-deployment.md`), Argo ignoring replicas and hibernation annotations, Argo treating a hibernated cluster as Healthy, and Karpenter consolidation.

To add:

1. An activator in front of API and web (KEDA HTTP add-on, Sablier, or the Caddy approach above).
2. Idle detection.
3. Faster wake: py-kube-downscaler polls every 60 s, so patch replicas directly or use KEDA.
4. A single owner of replica counts. The downscaler, migration quiesce Jobs and TTL Jobs already record and restore them.

A sleeping deployment still pays for EBS (2 x 5Gi gp3 by default) and its share of Envoy, system nodes and the NLB.

### Existing scaledown spec (K8STSD)

[Tamanu deployment scaledown](artefact:docs/spec/kubernetes/tamanu/scaledown.md) already specifies the sleep and wake mechanics this work builds on. It is driven by a time to live (`ttlHours`), not by demand.

- Hibernation: `downscaler/force-downtime=true` on every Deployment, `cnpg.io/hibernation=on` on every database cluster, volumes retained. This is the sleep sequence above, already specified.
- Waking: remove the force-downtime annotation, set `cnpg.io/hibernation=off`, and never change the end of the time to live. A suspended `wake` CronJob lets a person trigger it.
- A `tamanu-ttl` service account, limited to Deployments and database clusters in its namespace, runs both. This is the actuator's RBAC, already specified.
- The downscaler must act on Deployments only, run on system capacity, and leave unannotated workloads alone.
- Where it collides with the design here:
  - Hibernation must not change any other object, "including its Services, Gateways, routes". The actuator re-pointing routes at the supervisor on sleep would break that, unless the routes already point at the supervisor/Caddy permanently (the Caddy front removes the need to change routes).
  - Everything is keyed on a time to live. Demand-driven sleep has no end time, so it either needs its own trigger or needs the TTL concept generalised.
  - The spec says nothing about who triggers a wake besides a person and updates of the deployment. A supervisor calling the actuator is a new waker.

#### Direction: idle sleep replaces the time to live

Decided: demand-driven sleep replaces `ttlHours`. Every deployment sleeps when idle, which beats a fixed end time.

- Superseded: the `ttlHours` parameter and its validation, the end-of-TTL anchoring, the scheduled hibernation Jobs (and the second "safety" run), and the TTL framing of the whole spec.
- Kept, now driven by the actuator instead of CronJobs: the hibernation and wake steps, the `tamanu-ttl` service account (rename, since nothing is a TTL any more), the downscaler on system capacity, and the Argo ignored-differences and database-health rules in K8STDR.
- Kept: wake on every update. A rollout needs the database up for migrations and hooks, and the deployment then idles back to sleep by itself.
- The manual `wake` CronJob and the Argo Create Job action become a manual override, or go if the supervisor's wake page is enough. Hand-waking is no longer the normal path.
- Lost: the TTL was a hard cost cap. Anything that keeps a deployment looking busy (monitoring probes, crawlers, a stuck sync loop) now keeps it up indefinitely, where the TTL used to stop it regardless. The idle signal must ignore health probes and monitoring checks, and a deployment that never sleeps needs to be visible (a metric or alert), since nothing else will catch it.
- Unchanged: a sleeping deployment still pays for EBS, as a TTL-hibernated one did.

Correction: an earlier version of this doc assumed a deployment sleeps as a unit (central and its facilities together), which made an infra-only activator enough to retire the TTL. That was an assumption I introduced when replacing the TTL, and it was wrong: the design is per server. A facility's sync is traffic at central, so without the flag check a facility would keep central awake, and the Tamanu-side pieces (flag check, supervisor login, access tally) are needed from the first release. The doc's order of work reflects that.

## Trade-offs

- Supervisor in Tamanu versus an infra-side controller: dirty-flag logic depends on sync, which points to Tamanu. Infra-only controllers (activator, KEDA, Sablier) cannot answer "anything for me?".
- Aurora buys less operations work, not a lower bill.
- Storage-separated Postgres would only shorten wake (sub-second compute start) and cut storage cost. Not the bottleneck at a few minutes. Revisit only if instant wake without a splash page is wanted.
- Per-deployment actuator is simplest and least privileged; per-cluster is fewer pods but needs cluster-wide RBAC and caller authentication.

## Open questions

- [ ] Is the supervisor part of Tamanu or an infra-side controller?
- [ ] What is a cold wake today? Measure CNPG unhibernate plus app start on a PR deployment, with and without a fresh Karpenter node.
- [ ] Should a sleeping deployment keep 2 CNPG instances? That doubles EBS and resume work.
- [x] Q17 (decided): a sleeping server shows as Deployments at zero replicas and a hibernated database cluster. An explicit state set by the actuator says the server is asleep (or waking), so nothing has to infer it from `downscaler/force-downtime` and `cnpg.io/hibernation`. Stale-sync checks on other servers may also read a sleeping one as stale, since sync stops by design; not checked whether such a check exists.
- [x] Q18 (decided: the Argo Application; the Namespace and the supervisor Deployment were the alternatives, and the Application is where operators already look and what Argo's UI filters on). Consequences for the K8STSD rewrite: the actuator's service account gets a Role in Argo's namespace limited to its own Application by name, the rule that hibernation must not change the Application is reworded to allow this one annotation, and Pulumi, which owns the Application's metadata, ignores changes to it. Detail for the spec: a label rather than an annotation lets the Argo UI filter by it (the Application already carries `bes.tamanu/*` labels); state is per server, so there is one label or annotation per server (central, facility-1, and so on), each a short value such as awake, waking or asleep. Original reasoning follows. Where does the state annotation live? On the Namespace: integrations find deployments by namespace anyway, but patching a Namespace needs cluster-scoped permission (limitable to one name), which breaks K8STSD's rule that the service account holds permissions only on Deployments and database clusters in its own namespace, and Argo needs an ignored difference if it manages the Namespace. On the supervisor's own Deployment: no new permission, and it always exists. Lean: the supervisor Deployment. Either way K8STSD's "every Deployment gets force-downtime" must exclude the supervisor, which stays up.
- [ ] Mobile: back off when backgrounded, and poll the supervisor instead of opening sessions?
- [ ] Production on Kubernetes has no spec yet: data sovereignty, uptime and backups for sleeping clusters.
- [ ] Check Sydney prices for Aurora, EBS gp3 and Graviton on-demand before any cost case.
- [x] Hibernation (K8STSD) must not change routes: settled by Q16. Caddy is the permanent backend, so the rule survives.
- [ ] With the TTL gone, what catches a deployment that never sleeps? An "awake for more than N hours" alert, or a hard maximum awake time?
- [ ] The access tally: what does it hold (device id, time, kind), where does it persist (SQLite) so a supervisor restart loses nothing, how is the flush made idempotent, and how is its size bounded? Which Tamanu records does it feed (`Device.lastSeenAt`, the `accesses` audit log)?
- [ ] Q3: the supervisor should be able to verify device credentials itself while the database is down (direction, from discussion). Findings from Tamanu's central auth (`packages/central-server/app/auth/`, `User.loginFromToken`): access tokens are HS256 JWTs signed with one shared secret (`config.auth.secret`), carrying issuer, audience, expiry, `userId`, `deviceId` and `facilityId`. Signature, issuer, audience and expiry can be checked without the database. Whether the user is still current and the device still exists are database lookups, so they happen at flush. Forgery is ruled out while asleep. Revocation is covered by copying the users table (password hashes included) and the devices table into the supervisor's own store, at the same moment as the counter (Q4). The supervisor is Node, so it implements credential checks itself, reusing Tamanu's code. Nothing changes while central is down, so the copy is exact for the whole sleep. Facilities already hold a copy of the users table with hashes for their local-login fallback, so this is not a new kind of exposure. Authorisation (`canSync`, facility access) depends on roles and permissions, which are not copied: the flag check needs identity (a current user on a known device), and a user who cannot sync learning a counter is harmless.
- [x] Q5 (decided): an expired access token does not wake central. The supervisor serves token refresh itself. Refresh tokens are checked against the database, so their records are copied at sleep too, and the new refresh tokens the supervisor issues (rotations included) are part of the check-in handed to the database on wake.
- [x] Q6: the supervisor holds the HS256 secret. Settled by implication: it implements login and checks credentials itself, so it must be able to sign and verify tokens. The pod also holds the infra actuator, so the secret must be mounted only into the supervisor container.
- [x] Q7 (decided, supersedes the earlier proposal): the supervisor implements login and refresh while central sleeps, not only credential checks. The sessions it creates join the check-in on wake. See Q11 and Q12 for what that takes.
- [x] Q11 (decided): the supervisor builds the login response from copied tables, running Tamanu's own login code unchanged, not a reimplementation and not payloads pre-computed by central. The response needs permissions, role, allowed facilities, localisation and settings, so the copy covers every table that code reads, beyond users, devices and refresh tokens.
- [x] Q14 (decided: PGlite): an embedded Postgres in the supervisor process hosts the copy, so Tamanu's code runs on it unchanged (its models target Postgres, so SQLite would force changes). Spike done, see "PGlite spike results" below: it works, with a memory cost and a single-connection constraint. The supervisor's own small state (tally, flags) can stay in SQLite either way. The copy is rebuilt from schema and data at each sleep and deleted on wake, so it never needs migrations of its own, but the supervisor and the schema must be the same Tamanu version.
- [ ] Q24: is about 190 MB per server (the measured floor on Node with `tsx`, 170 MB on Bun, with a tuned Postgres at about 10 MB of its own memory plus cache) acceptable for the supervisor, with the Caddy container on top? A memory request needs headroom above the floor, so about 250 MB in practice. Compare with what sleeping frees: an awake server runs about eight small pods plus two database instances. Lean: yes. Stop shrinking here and treat a bundle as a later optimisation.
- [x] Q22 (decided): the supervisor is a single resident process that requests its full memory, because it must never be killed. A short-lived child process would not lower the request, so the child-process option is dropped. The work is to shrink the number: see Q23.
- [ ] Q23 (progress): shrink the supervisor's memory. Measured so far (spike results, "Memory" below): the whole login process floor is about 400 MB stock and 256 to 320 MB with PGlite's `shared_buffers` cut from 128 MB to 8 MB. What remains is roughly Node 18 MB, PGlite 140 MB, Tamanu's code 150 MB and 161 registered models 50 MB. Avenues, largest first: (a) load only what login needs instead of the whole `@tamanu/database` barrel and every model, via a purpose-built supervisor entry point or a tree-shaken bundle, still running Tamanu's own login code (up to about 200 MB, unmeasured); (b) a V8 code cache or startup snapshot; (c) done: a real Postgres tuned small in the pod instead of PGlite brings the whole process to a floor of about 160 MB (see above); (d) a small bespoke login that does not load Tamanu's code at all, which cuts about 200 MB but gives up running Tamanu's own code and so the drift guard in Q15 changes shape. Decided direction: real tuned Postgres instead of PGlite (c), then (a); (d) stays the fallback if (a) cannot get under the budget. What budget is acceptable per server? Compare with the saving: an awake server's app pods are each about 200 to 256 Mi. Status: (c) done, floor about 160 MB for Postgres, Node and Tamanu's login code together. (a) as framed saves little: dropping the obviously unneeded packages saves about 13 MB. A real gain would need a bundle of Tamanu's ESM sources with tree-shaking and minification, which is a larger Tamanu-side build change with unknown payoff, or (d). (e) Run the supervisor under Bun: measured, saves about 20 MB at the floor (168 against 192 MB), works unchanged; not worth the support question on its own.
- [x] Q15 (decided in shape): the table list the login code reads will drift as login changes. The list is an allowlist, so a new table holding patient data is never copied by default. The guard is the existing login test suite run against a copy built from the list, not a bespoke test, so it reuses the coverage of every login branch. A login path that reads a table outside the list then fails with a missing relation. Limit: a branch the suite does not exercise is not guarded.
- [x] Q12 (decided): login from an unknown device registers a new device, and that device needs an initial sync anyway, so a login from a device not in the devices copy wakes central.
- [x] Q8 (decided): the users copy holds password hashes, and the refresh-token records hold hashed refresh ids. Both are taken at sleep and deleted on wake, so they sit in a second place only while it is needed.
- [x] Q10 (decided: derived tick, no counter): is a counter needed, or a boolean? A single global boolean fails with more than one consumer: the first device to pull clears it and hides the change from the rest. A boolean per consumer works for a few known facilities, but for mobile it would need the supervisor to track every device and learn when each synced. A counter is the same boolean with each device's bit stored on the device. Alternative with no new state to maintain: Tamanu's sync lookup refresh only touches rows whose source `updated_at_sync_tick` moved (`updateLookupTable.js`), so the highest tick in `sync_lookup` moves only on real changes, and devices already send `lastSyncedTick`. The flag would then be "highest real-change tick is above the device's `lastSyncedTick`", read once at sleep after a final lookup refresh. Checked against the Tamanu code: (1) `sync_lookup` has a btree index led by `updated_at_sync_tick`, so the max is a cheap index scan, and the pending-refresh sentinels are negative so they never win the max. (2) Mobile reads its pull cursor (`lastSuccessfulSyncPull`, `-1` before the first sync) from local storage before opening a session, so it can send it in a pre-check; a first sync always differs and wakes central. (3) A device's own pushes are not sent back to it (`avoidRepull`, `pushed_by_device_id`), but a lookup refresh that runs after its pull can stamp the pushed rows with a tick above its cursor, so the flag can fire once for a session that pulls nothing, then settles. False positives only; the supervisor must take the value after a final lookup refresh at sleep so nothing committed is missing from it. Lean: use the derived tick, no counter.
- [x] Q2: every deployment sleeps by default, production included, with an opt-out setting.
- [ ] Q21: long-lived websockets must not count as activity. Facilities hold a permanent socket.io connection to central, and browser clients hold one to their facility (and central). Caddy sees an upgrade request once, then opaque frames, so an open-but-silent socket looks like one old request and a connection that never closes. Two problems: (a) the idle signal cannot be "connections open" or "last request", and (b) when the app scales to zero the sockets drop and clients reconnect, and a reconnect is a request that would wake the server and so keep it awake forever. Lean: a websocket upgrade neither counts as activity nor wakes a sleeping server (Caddy answers `503` while asleep, and clients retry with backoff, which needs checking in Tamanu's socket clients); real HTTP requests still wake it. What flows over the sockets today is Telegram and patient-contact events, which originate at central while awake, so nothing is lost by not waking for the socket itself. Also needs checking: does any socket message from a client mean user intent (it would then have to count), and does Caddy hold its upstream connection open across an app restart.
- [x] Q19 (decided): one Caddy, supervisor and actuator pod per server (central and each facility), so Kubernetes matches Linux and Windows production, where they sit on each server's box; that match was half the point. Hibernation's scope becomes one server's Deployments and database cluster, not everything in the namespace.
- [x] Q20 (decided: namespace-wide, as today): the actuator's permissions. Per server, its service account could be namespace-wide (so a facility's actuator could in principle scale central, within one deployment owned by the same people) or limited by resource name to its own server's Deployments and database cluster (rendered lists, little added safety). Lean: namespace-wide, as K8STSD's service account is today.
- [x] Q9 (decided; granularity amended): the opt-out is one boolean per server, not per deployment, because the quiet-facility purpose is a per-facility decision (name to be settled in the spec). The per-deployment wording came from the whole-deployment assumption corrected above. It is a true opt-out: nothing requires it to be stated, and a deployment that omits it sleeps. A 24/7 site never goes 30 minutes without traffic, so it never sleeps and needs no opt-out. The opt-out serves testing, troubleshooting and bugs, and quiet facilities that need very fast access at odd hours (see Behaviour).
- [x] Which requests count as activity? Decided: all traffic except health probes, monitoring checks and the flag check, with a 30-minute idle timeout.
- [x] Q4 (decided, with the sleep-time reads now also covering refresh-token records and whatever Q11 settles on): the mobile flag check is answered while central sleeps, so something always-on must hold it (the supervisor, or Caddy). That pulls a small Tamanu-side piece (flag endpoint, mobile client change) into the first phase. The flag is the highest real-change tick (settled, Q10). How does the always-on part learn its value? Proposal: after the app is quiet, central runs a final lookup refresh, the supervisor reads the max tick (and copies the users and devices tables), then hibernates the database, and serves that value while asleep.
- [ ] What happens to existing deployments that set `ttlHours`? Ignore the parameter, remove it, or keep it as a hard cap until the activator is proven?

## Possible order of work

Needs re-deriving now that sleep is per server (see the correction above). Pieces, in dependency order:

1. The flag check and quiet idle sync on the Tamanu side: a "changes pending?" check before `startSyncSession`, and `SyncLookupRefresher` skipping writes when nothing changed. Pays off everywhere and is what stops a facility keeping central awake.
2. The supervisor and Caddy pod per server, the actuator, and the sleep-time copy (PGlite spike first).
3. Idle sleep per server for PR, demo and dev deployments, replacing `ttlHours`. Retires K8STSD's TTL machinery.
4. Production pilot, once a Kubernetes production spec exists.

## Testing notes

- [ ] Idle deployment with no users reaches zero app pods and a hibernated database, and stays there.
- [ ] First web request to a sleeping facility shows the waking page, then lands the user in a working app.
- [ ] Cross-wake: a patient entered at facility A overnight reaches facility B without B's API or web starting, and everything sleeps again.
- [ ] Admin login on a sleeping central wakes it.
- [ ] Scheduled reports and vaccination reminders fire on time from a sleeping state.
- [ ] Daily and hourly tasks missed during sleep run on wake.
- [ ] A retry or restart of supervisor or actuator mid-wake does not leave parts half-started.
- [ ] No fight over replica counts between the supervisor, the downscaler and migration or TTL Jobs.
- [ ] Always-on facilities are unaffected.

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

### Whole Kubernetes deployment (idle sleep)

Replaces the time to live. A deployment (central and its facilities in one namespace) sleeps and wakes as a unit.

- A deployment sleeps after 30 minutes with no activity.
- Activity is all traffic through the gateway, except health probes, Canopy checks and the "anything for me?" flag check.
- A request to a sleeping deployment starts the wake.
- Browser paths get a "waking up" splash page while it wakes.
- API paths (`/api`, `/v1`) get `503` with `Retry-After` and are not held open, since a wake can take minutes.
- Mobile devices check the flag before syncing. A device with nothing to push and nothing to pull does not wake central, and the check does not count as activity.
- A device with local changes to push wakes central.
- A wake on update (rollout) stays, so migrations and hooks have a database.
- A deployment that never sleeps is surfaced by an alert, because the TTL no longer stops it.

### Facility

- A small always-on supervisor beside the facility keeps API, web and Postgres down while there are no user requests and nothing to pull.
- Central answers "is there anything for me?" cheaply, before a sync session starts.
- The first request of the day gets a "waking up, about 5 minutes" page. The supervisor starts local services, pushes local changes (none after a clean shutdown), pulls what central has queued, then lets the user in.
- A facility wakes central only when it has data to push, someone logs in, or its flag is set.
- Opt-in per facility, for sites with reliable, fast internet. Offline-first sites stay always-on.

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
- Liveness reporting (`sendStatusToMetaServer`) and Canopy healthchecks will see a sleeping server as down.

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
5. Request routing belongs to the actuator: on sleep it points the routes at the supervisor, on wake back at the app.

Because the supervisor is out of the request path while awake, the app needs an activity endpoint (for example `GET /activity` on API and sync: last request time, work in flight). This is Tamanu-side work.

One actuator per deployment (namespaced `tamanu-ttl` service account, no cross-tenant permissions) versus one per cluster: start per deployment.

### Caddy as the supervisor's front

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
- Lost: the TTL was a hard cost cap. Anything that keeps a deployment looking busy (monitoring probes, crawlers, a stuck sync loop) now keeps it up indefinitely, where the TTL used to stop it regardless. The idle signal must ignore health probes and Canopy checks, and a deployment that never sleeps needs to be visible (a metric or alert), since nothing else will catch it.
- Unchanged: a sleeping deployment still pays for EBS, as a TTL-hibernated one did.

Sequencing consequence: a deployment in one namespace sleeps as a unit (central and its facilities together), so only external requests count as activity (users, mobile devices, integrations). Sync between its own members is irrelevant, because they all sleep together. That means the Kubernetes PR and demo case does not need the Tamanu-side changes (quiet sync, dirty flags, cross-wake): an infra-side activator that watches request traffic is enough to retire the TTL. Those changes matter for facilities that sleep independently of central (separate deployments, or Linux).

## Trade-offs

- Supervisor in Tamanu versus an infra-side controller: dirty-flag logic depends on sync, which points to Tamanu. Infra-only controllers (activator, KEDA, Sablier) cannot answer "anything for me?".
- Aurora buys less operations work, not a lower bill.
- Storage-separated Postgres would only shorten wake (sub-second compute start) and cut storage cost. Not the bottleneck at a few minutes. Revisit only if instant wake without a splash page is wanted.
- Per-deployment actuator is simplest and least privileged; per-cluster is fewer pods but needs cluster-wide RBAC and caller authentication.

## Open questions

- [ ] Is the supervisor part of Tamanu or an infra-side controller?
- [ ] What is a cold wake today? Measure CNPG unhibernate plus app start on a PR deployment, with and without a fresh Karpenter node.
- [ ] Should a sleeping deployment keep 2 CNPG instances? That doubles EBS and resume work.
- [ ] Which facilities qualify? Offline-first sites should stay always-on.
- [ ] How should Canopy healthchecks, meta-server liveness and stale-sync checks treat an intentionally sleeping server?
- [ ] Mobile: back off when backgrounded, and poll the supervisor instead of opening sessions?
- [ ] Production on Kubernetes has no spec yet: data sovereignty, uptime and backups for sleeping clusters.
- [ ] Check Sydney prices for Aurora, EBS gp3 and Graviton on-demand before any cost case.
- [ ] Hibernation (K8STSD) must not change routes, but the actuator re-points routes at the supervisor while asleep. Rewrite that rule, or point routes at Caddy or the supervisor permanently so it never applies?
- [ ] With the TTL gone, what catches a deployment that never sleeps? An "awake for more than N hours" alert, or a hard maximum awake time?
- [ ] Which deployments opt out of sleeping? Today the TTL is opt-in. Sleep by default, with an explicit always-on parameter for production and 24/7 sites?
- [x] Which requests count as activity? Decided: all traffic except health probes, Canopy checks and the flag check, with a 30-minute idle timeout.
- [ ] The mobile flag check is answered while central sleeps, so something always-on must hold it (the supervisor, or Caddy). That pulls a small Tamanu-side piece (flag endpoint, mobile client change) into the first phase. What does the flag record, and how does the always-on part learn that central data changed?
- [ ] What happens to existing deployments that set `ttlHours`? Ignore the parameter, remove it, or keep it as a hard cap until the activator is proven?

## Possible order of work

1. Wake-on-request and idle sleep for whole Kubernetes deployments (PR, demo, dev), replacing `ttlHours`: an activator in front of API and web, idle detection from external request traffic, and the existing hibernation and wake steps driven by the actuator. No Tamanu changes needed, no clinical risk, and where the 90-95% saving is. Retires K8STSD's TTL machinery.
2. Quieten idle sync: a "changes pending?" check before `startSyncSession`, and `SyncLookupRefresher` skipping writes when nothing changed. Pays off everywhere, and is the prerequisite for sleeping facilities independently of central.
3. Facility sleep, then central sleep with dirty flags. Pilot on a staging deployment with two facilities on working hours.
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

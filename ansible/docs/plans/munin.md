# Plan: local Munin on Tamanu servers, exposed over Tailscale only

## Goal

Give each Tamanu server rich, local, historical resource graphs (CPU, memory,
disk/IO, network, per-table Postgres detail, …) — far more granular than the
centralised health/alerting view in Canopy or the barely-used Elastic stack.
Munin runs entirely on-box (node + master + rendering on the same host); the
rendered UI is reachable only over the tailnet.

## Approved design decisions

- **Local-only Munin.** `munin` (master) + `munin-node` polling `127.0.0.1:4949`.
  No central master, no cross-host polling. munin-node binds loopback only, so
  nothing Munin-native listens off-box.
- **Exposure = Caddy vhost on the tailnet name, distinct port 4950** (Approach B).
  Caddy's automatic HTTPS natively fetches the Tailscale cert for a `.ts.net`
  site address, so the vhost is just the site address + file server — no explicit
  `tls`. Port 4950 sits right next to munin-node's canonical `4949` so it reads as
  "the munin web port" in the Tailscale ACL, while staying a distinct number from
  the node (avoids the confusion of the same port inside and out) and staying well
  below the Linux ephemeral range (32768–60999), so the listener can't lose a
  boot-time bind race to an outbound source port. munin-node itself stays on
  `127.0.0.1:4949`. Tailnet-only exposure comes from UFW: the ufw role opens only
  80/443 publicly with default-deny incoming, so a listener on 4950 is reachable
  only via the blanket `allow in on tailscale0` rule. No `bind` and no
  Tailscale-IP lookup needed — the same firewall model the public app already
  relies on.
- **Enabled fleet-wide by default** via `munin_enabled` (default `true`); set it
  `false` per inventory to opt a deployment out. Munin installs on every Tamanu
  host; the tailnet web vhost is added only where a Tailscale name exists (see
  below), so non-tailnet hosts still collect and render locally but have no
  remote view until a viewing path is decided for them.
- **Postgres plugins wired from the postgres role on detection.** The postgres
  role — which already owns the read-only `alertd_db_role` and its peer auth —
  installs and configures Munin's `postgres_*` plugins *when it detects
  munin-node installed*. The munin role does not touch Postgres.
- **btrfs subvolume-as-folder for the data home.** On btrfs hosts, `/var/lib/munin`
  (the RRD data home) is created as a nested subvolume in place
  (`btrfs subvolume create /var/lib/munin`) — a normal-looking folder that is its
  own subvolume, so it gets an independent snapshot boundary. No separate mount,
  no fstab entry (unlike the postgres role's `@postgres`). `nodatacow` is set on
  it with `chattr +C` while empty, so RRDs created later inherit it — copy-on-write
  is exactly what fragments frequently-rewritten RRD files. On non-btrfs hosts it
  is a plain directory. Done before the package installs so Munin writes straight
  into the subvolume.
- **Static rendering** (stock `munin-cron`, 5-min HTML+PNG) served by Caddy
  `file_server`. On-demand CGI is a deferred enhancement (see below).

## Why this shape

- The tailnet name (`<host>.<tailnet>.ts.net`) has exactly one address and the
  app already binds `:443` on it; a distinct port on the same name is the only
  way to add a second service without editing the tamanu Caddy template.
- The ufw role opens only 80/443 publicly with default-deny incoming, plus a
  blanket `allow in on tailscale0`. So a 4950 listener is reachable only over the
  tailnet with **no ufw change** and no `bind` — the same model the public app
  already relies on.
- Peer auth (`map=alertd`, root → `alertd_db_role`) means Munin's postgres
  plugins, run as root over the socket, authenticate with no new credentials.

## Role: `munin` (new)

Ordered in `tamanu-install.yml` **after** `caddy` and `tailscale` (needs both),
guarded `when: munin_enabled | default(true)`, tagged `[base, munin]`.

- `defaults/main.yml`: `munin_enabled: true`; `munin_tailscale_port: 4950`.
- `tasks/main.yml`:
  1. `tasks/data-dir.yml` (below) — create `/var/lib/munin` as a btrfs
     subvolume-as-folder (or plain dir off btrfs), **before** the package install.
  2. Install `munin`, `munin-node` from stock Ubuntu apt (no new repo).
  3. Configure `munin-node` to bind `127.0.0.1` only (`host 127.0.0.1` in
     `munin-node.conf`); enable + start the service.
  4. Configure `munin.conf` for the default `localhost` node (stock default is
     already local; assert/keep it).
  5. Drop `/etc/caddy/servers/munin` (template) — see below — and reload Caddy.
     Guard on `caddy_configured` **and** `tailscale_name is defined` (no tailnet
     name → no web vhost, but Munin still installs and collects locally).

### `tasks/data-dir.yml`

- Detect the fstype of the parent (`findmnt -n -o FSTYPE /var/lib`).
- **btrfs**: if `/var/lib/munin` does not already exist, `btrfs subvolume create
  /var/lib/munin`, then `chattr +C /var/lib/munin` while it is empty (so new RRDs
  inherit nodatacow). Guard on non-existence so re-runs are a no-op and we never
  touch a populated dir.
- **non-btrfs**: `mkdir /var/lib/munin` (plain directory).
- Either way the package install (next step) populates it.

### Caddy vhost template (`/etc/caddy/servers/munin`)

```
https://{{ tailscale_name }}.{{ tailnet }}.ts.net:{{ munin_tailscale_port }} {
  root * /var/cache/munin/www
  file_server browse
}
```

No `tls` directive: Caddy's automatic HTTPS natively fetches the Tailscale cert
for a `.ts.net` site address from the local `tailscaled` API (authorised by
`TS_PERMIT_CERT_UID=caddy`, set by `caddy/tasks/tailscale.yml`). No `bind` either
(see the exposure decision above).

## Postgres role change

New `tasks/munin-plugins.yml`, included from `roles/postgres/tasks/main.yml`
after `monitoring-user.yml`:

1. `package_facts` (apt); proceed only when `munin-node` is present.
2. Install `libdbd-pg-perl` (required by the `postgres_*` plugins).
3. Symlink the wanted `postgres_*` wildcard plugins from
   `/usr/share/munin/plugins` into `/etc/munin/plugins` (use
   `munin-node-configure --suggest --shell` output, or an explicit curated
   list — favour the explicit list for determinism).
4. Drop `/etc/munin/plugin-conf.d/postgres` so the plugins connect as the
   existing monitoring role over the socket:
   ```
   [postgres_*]
   user root
   env.PGUSER {{ alertd_db_role }}
   env.PGHOST /var/run/postgresql
   ```
5. Notify a `munin-node` restart.

All steps are no-ops where munin-node isn't installed, so the postgres role
stays correct on every host regardless of `munin_enabled`.

## Known behaviour: two-pass DB-plugin wiring

Because the postgres role runs *before* the munin role in the play and keys off
package detection, on a **fresh** converge of a newly `munin_enabled` host the
postgres role runs before Munin is installed, so the DB plugins are wired on the
**next** converge (system graphs appear immediately; Postgres graphs one run
later). This is inherent to the detection-based decoupling you asked for. If
single-pass wiring is wanted, the follow-up is to install the munin package in
an earlier role; noted, not done here.

## Explicitly out of scope

- **Tailscale ACLs.** Restricting *which* tailnet identities may reach `:4950`
  lives in the separate Tailscale policy repo, not here. This plan only makes
  the port a clean, distinct ACL target.
- **On-demand CGI rendering** (`munin-cgi` + `fcgiwrap`), which would cut the
  5-min render load and give zoomable graphs. Deferred; static rendering first.
- **On-prem hosts without Tailscale**: default-on installs Munin and
  it collects/renders locally, but the Caddy vhost is skipped (no tailnet name),
  so there is no remote view until a per-host viewing path (e.g. SSH tunnel) is
  decided. Set `munin_enabled: false` for such an inventory if even local install
  is unwanted.

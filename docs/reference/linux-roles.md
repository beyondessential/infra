# Reference: Linux playbooks and roles

What each playbook runs on a Linux Tamanu server, and what each role is for.
The requirements are in [LNXSRV](../spec/linux/server.md), [LNXDB](../spec/linux/database.md), [LNXAPP](../spec/linux/application.md) and [LNXBAK](../spec/linux/backups.md); the procedures are [run the playbooks](../sops/linux-run-playbooks.md) and [upgrade Tamanu](../sops/linux-upgrade-tamanu.md).
Everything here is under `ansible/`.

## Playbooks

| playbook | hosts | what it does | tags |
|---|---|---|---|
| `base-install.yml` | all | `baseline`, `toolbox`, `tailscale` where `tailscale_name` is set, `podman`. Nothing Tamanu-specific. | `base` |
| `tamanu-install.yml` | all, then `central`, then `facility` | The whole stack. Common play: split-layout volumes, `baseline`, `toolbox`, `postgres`, `tailscale`, `caddy`, `munin`, `podman`, `kopia`, `elastic-agent`, `ufw`, `iti`. Then per type: `postgres-database`, `tamanu-single-install`, `bestool`, and `msupply-install` on facilities. | `base`, `app`, `volumes`, per-role tags |
| `tamanu-upgrade.yml` | all, `central`, `facility` | Asserts `tamanu_version` and `canopy_intent=upgrade`. Pre play repeats the install roles for the type, go play runs `tamanu-single-upgrade` (and `msupply-upgrade`). | `pre`, `go` |
| `tamanu-frontend-upgrade.yml` | `central`, `facility` | Moves only `tamanu_frontend_version`. Needs `canopy_intent=upgrade`. | none |
| `postgres-upgrade-check.yml` | all | Read-only. Prints one of `NO_POSTGRES`, `NO_UPGRADE_NEEDED`, `WILL_UPGRADE`, `UPGRADE_BLOCKED`, `UNKNOWN`. | none |
| `check-linux-lpe-2026.yml` | all | Read-only report of exposure to the blocked kernel modules. `-e lpe_fail_on_exposed=true` fails the play on exposure. | none |
| `convert-three-disk-to-btrfs.yml` | all | Staged conversion of the split layout to a single btrfs root. [Procedure](../sops/linux-convert-disk-layout.md). | per phase |

`tamanu-install.yml` and `tamanu-upgrade.yml` read EC2 instance tags through the metadata service where the host is an EC2 instance ([instance tags](../spec/linux/server.md#instance-tags)).

## Roles

| role | scope | what it owns | spec |
|---|---|---|---|
| `common` | dependency of most roles | Shared handlers (all tagged `always`, so tag-limited runs still reload services), `alertd_db_role`, `tailnet`, `caddy_canopy_certificates`, `ufw_managed`. | [LNXSRV](../spec/linux/server.md) |
| `baseline` | all | Locales, timezone, BES package repository, packages and auto-update crons, chrony, hostname and resolver, systemd accounting, resource-class slices, bfq, journald, rsyslog excludes, TCP tuning, kernel module block, btrfs balance, scrub and swap. Removes snapper. | [server](../spec/linux/server.md#platform) |
| `toolbox` | all | Operator tools: `bestool` package and daily update, `edit`, `starship`, tmux, htop, `tsw`. | [server](../spec/linux/server.md#package-sources-and-updates) |
| `ebs-volume` | split layout | Finds an EBS volume by NVMe alias, formats it if empty, copies existing files, mounts by UUID, grows the filesystem. | [server](../spec/linux/server.md#storage-layout) |
| `tailscale` | where `tailscale_name` is set | Repository, package, `ts-up` helper, and the Tailscale `listen_addresses` and `pg_hba` entries for PostgreSQL. | [server](../spec/linux/server.md#access) |
| `podman` | all | Podman, crun, netavark and aardvark from the BES repository, the `podman0` network, the resolver route for `tamanu.internal`, daily dangling-image prune. | [application](../spec/linux/application.md#container-runtime) |
| `postgres` | all | PGDG repository, version detection, `@postgres` subvolume, packages, access, `alertd` role, Munin plugins, btrfs tuning, quota, WAL settings, tuning, backup definitions, major upgrade. | [database](../spec/linux/database.md) |
| `postgres-database` | `central`, `facility` | The `tamanu` database and its owner, with a derived password. | [database](../spec/linux/database.md#roles-and-credentials) |
| `caddy` | all | Package at `caddy_version`, socket activation, issuer, DNS-01 credentials, UDP buffers, backup definition, Munin plugin. | [application](../spec/linux/application.md#reverse-proxy) |
| `munin` | all unless `munin_enabled` is false | `munin` and `munin-node`, node on loopback, tailnet vhost on 4950, nodatacow `/var/lib/munin`. | [server](../spec/linux/server.md#metrics) |
| `kopia` | all | Removes the upstream Kopia repository and the self-run Kopia timers and connection. The `kopia` package and user come from `baseline`. | [backups](../spec/linux/backups.md) |
| `elastic-agent` | all | Installs and enrols the agent where enabled with a token, otherwise removes it. | [server](../spec/linux/server.md#endpoint-security-agent) |
| `ufw` | all unless `dangerously_leave_ufw_alone` | Manages the rules where `ufw_managed`, otherwise stops and disables ufw. | [server](../spec/linux/server.md#host-firewall) |
| `iti` | where `is_iti` is true | Raspberry Pi devices only. Not covered by the Tamanu server specs. | none |
| `tamanu-single-common` | dependency of the `tamanu-single-*` roles | The `tamanu` user and group, `/etc/bestool` permissions, the `kopia` sudoers entry for `tamanu`, `/etc/tamanu/env`, image pruning. | [application](../spec/linux/application.md#configuration) |
| `tamanu-single-install` | `central`, `facility` | Config directories and files, quadlets and drop-ins, boot and roll-on-postgres units, reporting roles, clone setup, backup definitions, Caddy sites. | [application](../spec/linux/application.md) |
| `tamanu-single-upgrade` | `central`, `facility` | The ordered upgrade. | [upgrades](../spec/linux/application.md#upgrades) |
| `tamanu-single-frontend-upgrade` | `central`, `facility` | The frontend-only upgrade. | [upgrades](../spec/linux/application.md#upgrades) |
| `bestool` | `central`, `facility` | The `bestool-alertd` daemon: unit or drop-ins, database URLs, admission of Caddy to the certificate endpoint, Munin plugin, a connect check. | [application](../spec/linux/application.md#certificates) |
| `msupply-common`, `msupply-install`, `msupply-upgrade` | `facility` | Open mSupply as a quadlet with its Caddy site and optional Tailscale service. | [mSupply](../spec/linux/application.md#msupply) |

## Version gates on `bestool`

Roles branch on the installed `bestool` package version.
A host older than a gate gets the older behaviour, which matters when a play behaves differently from this page on one host.

| version | behaviour |
|---|---|
| below 1.8.0 | `local.json5` keeps Tamanu's own status sender on. |
| below 1.11.0 | A `bestool-doctor` timer runs `bestool tamanu doctor --send` every minute. At 1.11.0 or later the timer and service are removed. |
| below 1.21.0 | Install and upgrade refuse to run. |
| below 1.22.7 | The alert daemon unit runs `bestool tamanu alertd run` instead of `bestool alertd run`. |
| below 1.23.0 | The upgrade omits `--ignore-unmatched` from `start` and `restart`. |
| below 1.26.0 | The role writes the whole `bestool-alertd.service`. From 1.26.0 the package ships it and the role writes drop-ins. |
| below 2.2.0 | Sites never name the Canopy certificate endpoint. |

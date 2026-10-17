# Reference: Linux server paths, units and ports

Where things are on a Linux Tamanu server, for troubleshooting.
What each one must hold is in the specs: [LNXSRV](../spec/linux/server.md), [LNXDB](../spec/linux/database.md), [LNXAPP](../spec/linux/application.md), [LNXBAK](../spec/linux/backups.md).
For frontline commands (`bestool tamanu doctor`, `status`, `logs`, `htop`, `podman ps`) use the Tamanu pack's [maintain Tamanu on Linux](https://github.com/beyondessential/tamanu/blob/main/docs/reference/maintain-tamanu-on-linux.md).
Reading `/etc/tamanu/env` and `local.json5` prints database passwords: tag it **sensitive-data**.

## Units

| unit | what it is | notes |
|---|---|---|
| `tamanu-frontend@a`, `@b` | Frontend | Both roles. Rolled one at a time. |
| `tamanu-central-api@1`, `@2`, `tamanu-central-tasks`, `tamanu-central-fhir-refresh`, `tamanu-central-fhir-resolve` | Central services | |
| `tamanu-patientportal@a`, `@b` | Patient portal | Central, where enabled. |
| `tamanu-facility-api@1`, `@2`, `tamanu-facility-tasks`, `tamanu-facility-sync` | Facility services | |
| `tamanu-boot.service` | Oneshot that runs `bestool tamanu start` after the network is up | The only thing that starts Tamanu at boot. The quadlets have no install section. |
| `tamanu-roll-on-postgres.service` | Oneshot that rolls running Tamanu services when PostgreSQL starts | Skips when no frontend is active, so a deliberately stopped Tamanu stays stopped. |
| `postgresql@<version>-main` | The cluster | Slice `critical.slice`, restarts after 30 seconds on failure. |
| `caddy.socket`, `caddy.service` | Proxy | The socket is enabled; the service starts on first connection. |
| `bestool-alertd.service` | Alert daemon, backups, certificate endpoint on `127.0.0.1:8271` | Runs as root with a reduced capability set. |
| `tailscaled.service` | Tailscale | |
| `podman.socket` | Rootful Podman API for the alert daemon | |
| `podman-images-clean.timer` | Daily dangling image prune | |
| `btrfs-balance.timer`, `btrfs-scrub.timer` | Weekly balance, monthly scrub | |
| `chrony.service` | Time | `systemd-timesyncd` is masked. |
| `munin-node.service` | Metrics | Loopback only. |
| `msupply.service`, `msupply-tailscale-serve.service` | mSupply | Where enabled. |

Containers run as `systemd-<unit>`, so the journal identifier of a service is `systemd-tamanu-central-api@1` and the syslog program is `systemd-tamanu...`.

## Files

| path | what | owner and mode |
|---|---|---|
| `/etc/tamanu/env` | Versions, `TZ`, `DATABASE_URL`. Rewritten by every run. | `tamanu:tamanu` 0640 |
| `/etc/tamanu/current` | Symlink to the active version directory | |
| `/etc/tamanu/<version>/production.json5` | Tamanu config. Edit this one. Copied forward at each version. | `tamanu:tamanu` 0660 |
| `/etc/tamanu/<version>/local.json5` | Generated config. Overwritten by every run. | `root:tamanu` 0440 |
| `/etc/tamanu/<version>/default.json5` | Copy of the image's defaults, for reference | `tamanu:tamanu` 0440 |
| `/usr/local/bin/tamanu-run` | Run a command in a server container: `tamanu-run current <command>` or `tamanu-run <tag> <command>` | 0755 |
| `/etc/containers/systemd/` | Quadlets and the `tamanu-.container.d` drop-ins (`crypto-secret.conf`, `noipv6.conf`, `host-ca-certs.conf`) | |
| `/etc/bestool/` | Alert daemon and backup configuration, group `tamanu`, setgid | `root:tamanu` 2775 |
| `/etc/bestool/backups/*.toml` | [Backup definitions](../spec/linux/backups.md#backup-definitions) | `root:root` 0644 |
| `/etc/bestool/clone-setup.sh`, `/etc/bestool/clone-sync/` | Clone setup script and sync accounts | root, postgres |
| `/etc/tamanu/clone-sync-password` | A clone facility's sync password | `root:root` 0400 |
| `/etc/caddy/{snippets,servers,config}/` | Caddy configuration the roles write | |
| `/var/log/caddy/access.log` | Caddy access log, JSON, 100 MiB, 10 files | |
| `/var/lib/caddy/.aws/credentials` | Route 53 credentials for DNS-01, external servers only | `caddy` 0600 |
| `/etc/postgresql/current`, `/var/lib/postgresql/current` | Symlinks to the running version | |
| `/etc/postgresql/current/main/{postgresql.conf,pg_hba.conf,pg_ident.conf}` | PostgreSQL configuration | |
| `/var/lib/postgresql/<version>/main/postgresql.auto.conf` | Where the tuning lives | |
| `/etc/msupply/{env,local.yaml}`, `/var/lib/msupply` | mSupply | `msupply` |
| `/etc/modprobe.d/cve-2026-linux-lpe.conf` | Blocked kernel modules | |
| `/etc/apt/sources.list.d/`, `/etc/apt/preferences.d/99-*` | Repositories and pins | |
| `/root/.disk-conversion-metadata-v2.json` | Progress of the disk conversion | |
| `/.swap/swap.img` | Swap file on a btrfs root | |

The Podman secret `tamanu-config-key` is the [server key](../spec/linux/application.md#server-key): `sudo podman secret ls` shows that it exists, and nothing should print its value.

## Ports and addresses

| port | what |
|---|---|
| TCP 80, TCP 443, UDP 443 | Caddy, on `[::]` |
| TCP 4950 | Munin graphs on the Tailscale hostname |
| TCP 5432 | PostgreSQL on `localhost` and the Tailscale addresses |
| TCP 3000 | Every Tamanu container, on its network alias |
| TCP 8000 | mSupply |
| `127.0.0.1:8271` | The alert daemon's certificate endpoint |
| `10.100.0.1` | Podman gateway and container DNS, aardvark on port 53 |

## Hostnames

Container names resolve in `tamanu.internal` (and `msupply.internal`), for example `api.central.tamanu.internal`, through the resolver route that `podman` writes in `/etc/systemd/network/podman.network` ([aliases](../spec/linux/application.md#container-runtime)).
The Caddy sites resolve those names through the Podman gateway, not through the host resolver.

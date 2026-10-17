---
id: LNXRUN
---

# Tamanu runtime on a Linux server

The requirements in this spec apply to the Tamanu services of every [Linux server](../overview.md#linux-server) and to the reverse proxy in front of them.
The host is specified by [LNXSRV](server.md), the database by [LNXDB](database.md), backups by [LNXBAK](backups.md), certificates by [LNXTLS](tls.md), and the installation of this arrangement by [LNXANS](ansible.md).

## Borrowed terms

| term | meaning |
|---|---|
| quadlet | A systemd unit generated from a `.container` file that describes a Podman container ([podman-systemd.unit](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)). |
| template unit | A systemd unit whose name ends in `@` and whose instances are named by the text after the `@` ([systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)). |
| network alias | A name under which the other containers of a Podman network resolve a container ([podman-systemd.unit](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)). |
| podman secret | A named secret that Podman stores and mounts into a container at `/run/secrets` ([podman-secret](https://docs.podman.io/en/latest/markdown/podman-secret.1.html)). |
| socket activation | Starting a service on the first connection to a socket that systemd holds ([systemd.socket](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html)). |
| Caddy | The web server that terminates TLS, serves HTTP/3 and reverse proxies ([Caddy documentation](https://caddyserver.com/docs/)). |

## Services

A Linux server MUST run the Tamanu services in the following table, each as a quadlet whose unit name is given.
The duty that each service performs is named by bestool's [duty vocabulary](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/substrate.md#the-duty-vocabulary).

| unit | server type | instances | image | command |
|---|---|---|---|---|
| `tamanu-frontend@<i>` | both | `a` and `b` | `ghcr.io/beyondessential/tamanu-frontend` | the image default |
| `tamanu-central-api@<i>` | central | `1` and `2` | `ghcr.io/beyondessential/tamanu-central` | `startApi` |
| `tamanu-central-tasks` | central | one | `ghcr.io/beyondessential/tamanu-central` | `startTasks` |
| `tamanu-central-fhir-refresh` | central | one | `ghcr.io/beyondessential/tamanu-central` | `startFhirWorker --topics=fhir.refresh.allFromUpstream,fhir.refresh.entireResource,fhir.refresh.fromUpstream` |
| `tamanu-central-fhir-resolve` | central | one | `ghcr.io/beyondessential/tamanu-central` | `startFhirWorker --topics=fhir.resolver` |
| `tamanu-patientportal@<i>` | central, with a patient portal | `a` and `b` | `ghcr.io/beyondessential/tamanu-patient-portal` | the image default |
| `tamanu-facility-api@<i>` | facility | `1` and `2` | `ghcr.io/beyondessential/tamanu-facility` | `startApi` |
| `tamanu-facility-tasks` | facility | one | `ghcr.io/beyondessential/tamanu-facility` | `startTasks` |
| `tamanu-facility-sync` | facility | one | `ghcr.io/beyondessential/tamanu-facility` | `startSync` |

A central server MUST run the patient portal services where a patient portal is enabled for it.
A facility server MUST NOT run the patient portal services.
The Tamanu services of a server MUST run only the instances in the table.

Every Tamanu quadlet MUST have the properties in the following table.

| property | value |
|---|---|
| environment file | `/etc/tamanu/env` |
| image tag | `TAMANU_VERSION`, or `TAMANU_FRONTEND_VERSION` for the frontend, from the environment file |
| volume | `/etc/tamanu/<TAMANU_VERSION>` mounted at `/config` |
| volume | `/var/run/postgresql` mounted at `/var/run/postgresql` |
| restart | always, after 5 seconds |

A Tamanu container SHOULD disable TCP slow start after idle in its network namespace.

A quadlet MUST NOT be enabled directly.

## Container runtime

A Linux server MUST run containers with Podman, using the netavark network backend with the nftables firewall driver.

The default Podman network of a server MUST be a bridge with the interface `podman0`, DNS enabled, and the subnets in the following table.

| family | subnet | gateway | condition |
|---|---|---|---|
| IPv4 | `10.100.0.1/16` | `10.100.0.1` | always |
| IPv6 | `fd62:6573:b558:f686::1/64` | `fd62:6573:b558:f686::1` | the host has a default IPv6 route |

The inventory MAY override the subnets, through [the inventory variables](ansible.md#inventory-variables).

The container DNS server MUST listen on port 53 of the gateway.

The host resolver MUST route names under `tamanu.internal` to the container DNS server of `podman0`.

Where the inventory disables IPv6 for Tamanu containers, every Tamanu container MUST disable IPv6 in its network namespace.

Where the inventory enables the host certificate store for Tamanu containers, every Tamanu container MUST mount the host directory `/etc/ssl/certs` read-only at `/host/etc/ssl/certs` and set `NODE_EXTRA_CA_CERTS` to `/host/etc/ssl/certs/ca-certificates.crt`.

Container images that no container references and that carry no tag SHOULD be pruned daily in the background [resource class](../overview.md#resource-class).

A Tamanu container MUST be reachable on port 3000 at the network aliases in the following table, where `<v>` is the version of the image with every `.` replaced by `-`.

| service | aliases |
|---|---|
| frontend instance `<i>` | `frontend.tamanu.internal`, `frontend-<i>.tamanu.internal`, `<v>.frontend.tamanu.internal`, `<v>.frontend-<i>.tamanu.internal` |
| API instance `<i>` of the server type `<t>` | `api.<t>.tamanu.internal`, `api-<i>.<t>.tamanu.internal`, `<v>.api.<t>.tamanu.internal`, `<v>.api-<i>.<t>.tamanu.internal` |
| facility sync | `syncapi.facility.tamanu.internal` |
| patient portal instance `<i>` | `patientportal.tamanu.internal`, `patientportal-<i>.tamanu.internal`, `<v>.patientportal.tamanu.internal`, `<v>.patientportal-<i>.tamanu.internal` |

## Configuration

A Tamanu server MUST have the files in the following table.

| path | mode and owner | holds |
|---|---|---|
| `/etc/tamanu/env` | 0640, `tamanu:tamanu` | the environment of every Tamanu container |
| `/etc/tamanu/<version>/production.json5` | 0660, `tamanu:tamanu` | the Tamanu configuration that operators edit |
| `/etc/tamanu/<version>/local.json5` | 0440, `root:tamanu` | the Tamanu configuration that this infrastructure provides |
| `/etc/tamanu/<version>/default.json5` | 0440, `tamanu:tamanu` | a copy of the defaults of the image, for reference |
| `/etc/tamanu/current` | a symbolic link to `/etc/tamanu/<version>` | the directory of the version that is deployed |

The environment variables that Tamanu reads are defined by [Tamanu's configuration sources](https://github.com/beyondessential/tamanu/blob/main/specs/administration/settings/overview.md#configuration-sources).
The file `/etc/tamanu/env` MUST contain the variables in the following table.

| variable | value |
|---|---|
| `TZ` | the host time zone |
| `PROXY_TRUSTED` | `loopback,linklocal,uniquelocal` |
| `TAMANU_VERSION` | the Tamanu version |
| `TAMANU_VERSION_DOMAIN` | the Tamanu version with every `.` replaced by `-` |
| `TAMANU_FRONTEND_VERSION` | the frontend version |
| `TAMANU_FRONTEND_VERSION_DOMAIN` | the frontend version with every `.` replaced by `-` |
| `DATABASE_URL` | a URL of the form `postgresql://<role>:<password>@/<database>?host=/var/run/postgresql` |

The file `local.json5` MUST set the keys in the following table.

| key | value |
|---|---|
| `crypto.keyFile` | `/run/secrets/tamanu-config-key` |
| `proxy.trusted` | `loopback, linklocal, uniquelocal` |
| `db.name`, `db.username`, `db.password` | the database, its owner and the password of the owner, as [LNXDB](database.md#roles-and-credentials) gives them |
| `db.host` | `/var/run/postgresql` |
| `db.port` | `null` |
| `db.migrateOnStartup` | `false` |
| `db.reportSchemas.connections.raw`, `db.reportSchemas.connections.reporting` | the user name and the derived password of the roles `raw` and `reporting` |
| `schedules.sendStatusToMetaServer.enabled` | `false`, where the installed [bestool](../overview.md#bestool) sends the status to the meta server |
| `disk.diskPath` | `/var/lib/postgresql`, on a central server |
| `patientPortal.portalUrl` | `https://` followed by the patient portal hostname, on a central server with the patient portal enabled |
| `sync.syncApiConnection` | host `http://syncapi.facility.tamanu.internal` and port 3000, on a facility server |

A Tamanu service MUST NOT run database migrations at start-up.

The file `local.json5` MUST NOT be edited by operators.

## Server key

Each Tamanu server MUST have a [server key](../overview.md#server-key), held as the podman secret `tamanu-config-key`.

The server key MUST be mounted into every Tamanu container at `/run/secrets/tamanu-config-key` with mode 0400.

> [!NOTE]
> A value that Tamanu encrypted under one server key cannot be decrypted under another, as Tamanu's [secret encryption](https://github.com/beyondessential/tamanu/blob/main/specs/administration/settings/secret-encryption.md#storage) describes.

## Command helper

A Linux server MUST provide the helper `/usr/local/bin/tamanu-run`, which runs a command in a container of the server image for the version that is named on its command line, or for the current version.

The container of the helper MUST have the configuration of that version at `/config`, the PostgreSQL socket directory, the environment file and the server key.

The helper MUST fail with an explanation where the server key does not exist.

## Boot and restart

A Linux server MUST bring up every Tamanu service that should be running when it boots, by a unit that is ordered after `network-online.target`.
The services that should be running are the expectations that bestool holds, as bestool's [workload](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/substrate.md#the-workload) describes.

A Linux server MUST restart its running Tamanu services in a rolling restart when PostgreSQL starts, by a unit that PostgreSQL wants and that is ordered after it.

The rolling restart unit MUST run only where a frontend instance is active.

The rolling restart unit MUST NOT bind the lifetimes of the Tamanu services to PostgreSQL.

A rolling restart MUST restart API and frontend instances one at a time, keeping at least one critical instance serving, and MAY restart the other services together.

> [!NOTE]
> A restart of PostgreSQL severs the pooled connections of every service.
> A hard dependency would stop and start every service together with PostgreSQL and drop traffic.

## Reverse proxy

A Linux server MUST run [Caddy](#borrowed-terms) from the BES package, held against unattended upgrade at the version that the inventory names.

The proxy MUST be started by socket activation on `[::]:80` and `[::]:443` over TCP and `[::]:443` over UDP, and its service unit MUST NOT be enabled directly.

The proxy's service unit MUST be ordered after the [alert daemon](../overview.md#alert-daemon).

The proxy MUST read its site configuration from the directories in the following table.

| directory | holds |
|---|---|
| `/etc/caddy/snippets` | the snippets that the sites import |
| `/etc/caddy/servers` | one site file for each application that the proxy serves |
| `/etc/caddy/config` | the issuer and metrics configuration |

The proxy SHOULD raise the kernel receive and send buffer maxima for UDP, `net.core.rmem_max` and `net.core.wmem_max`, to 2500000 bytes.

The proxy MUST serve the sites in the following table.
The certificate of each HTTPS site is given by [LNXTLS](tls.md).

| site | served where | behaviour |
|---|---|---|
| any host over HTTP | always | serves Tamanu |
| `https://<public hostname>` | `tamanu_caddy_tls` is true and the hostname does not end in `.local` | serves Tamanu |
| `http://<public hostname>` | `tamanu_caddy_tls` is true and the hostname does not end in `.local` | redirects with status 308 to HTTPS |
| `https://<Tailscale name>.<tailnet>.ts.net` | the server has a Tailscale name and `tamanu_tailscale_tls` is true | serves Tamanu |
| an extra hostname | listed in `tamanu_caddy_extra_hostnames` | redirects with status 308 to the public hostname where `tamanu_caddy_extra_hostnames_redirect` is true, otherwise serves Tamanu |
| `https://<patient portal hostname>` | the patient portal is enabled and the hostname does not end in `.local` | serves the patient portal |

An extra hostname that ends in `.local`, or any extra hostname where `tamanu_caddy_tls` is false, MUST be served over HTTP only.

A site that serves Tamanu MUST behave as the following table gives.

| behaviour | requirement |
|---|---|
| API paths, `/v1/*` and `/api/*` | reverse proxied to `api.<server type>.tamanu.internal` port 3000, with `Cache-Control: no-store` on responses |
| every other path | reverse proxied to `frontend.tamanu.internal` port 3000, with the request header `Host` set to `localhost`, or to `patientportal.tamanu.internal` port 3000 with the same header on the patient portal site |
| `/v1/login` | redirected with status 308 to `/api/login`, on the Tamanu site |
| `/` | `Cache-Control: no-cache` |
| `/manifest.json` | `Cache-Control: no-cache`, on the Tamanu site |
| `/env.js` | the upstream response with `Cache-Control: public, max-age=604800, immutable`, on the Tamanu site |
| `/socket.io*` and `/api/socket.io*` | answered with 405, where the Tamanu version is lower than 2.48.0, on the Tamanu site |
| rate limit | 1000 events per second for each client address on API paths, and 10 events per second for each client address on `/api/login` |
| web application firewall | the files `waf*` of `/etc/caddy/servers` imported, where they exist |

The proxy MUST resolve upstream names through the container DNS server at the gateway of the default Podman network, to IPv4 addresses only.

The proxy MUST balance each upstream by least connections, and MUST retry a failed request on another instance, at most 2 times within 5 seconds.

The proxy MUST write one access log shared by every site, as JSON, to `/var/log/caddy/access.log`, rolled at 100 MiB and keeping 10 files.
Bestool reads that log, as its [log sources](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/logs.md#log-sources) describe.

The proxy's service unit MUST create the directory `/var/log/caddy` with mode 0750 at every start.

> [!NOTE]
> The directory `/var/log` can be a separate volume that is replaced independently of the root volume.

The proxy MUST expose its metrics with a series for each host, as bestool's [traffic statistics](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/substrate.md#http-traffic-and-certificates) read them.

## Health monitoring

A Linux server MUST run the alert daemon as the unit `bestool-alertd.service`, enabled at boot.

The alert daemon grades this arrangement with the checks that [bestool](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/healthchecks.md) defines.

The alert daemon MUST read the container runtime through the Podman API socket, and the unit `podman.socket` MUST be enabled.

The alert daemon MUST connect to PostgreSQL over the local socket as the role that [LNXDB](database.md#roles-and-credentials) gives it, to the database `postgres` and, where the Tamanu database exists, to that database.

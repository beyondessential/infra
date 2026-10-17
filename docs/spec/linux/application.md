---
id: LNXAPP
---

# Tamanu on a Linux server

The requirements in this spec apply to the Tamanu services of every [Linux server](../overview.md#linux-server), to Caddy, the reverse proxy in front of them, and to the certificates that Caddy serves.
The host is specified by [LNXSRV](server.md), the database by [LNXDB](database.md), and backups by [LNXBAK](backups.md).

## Borrowed terms

| term | meaning |
|---|---|
| quadlet | A systemd unit generated from a `.container` file that describes a Podman container ([podman-systemd.unit](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)). |
| template unit | A systemd unit whose name ends in `@` and whose instances are named by the text after the `@` ([systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)). |
| podman secret | A named secret that Podman stores and mounts into a container at `/run/secrets` ([podman-secret](https://docs.podman.io/en/latest/markdown/podman-secret.1.html)). |
| Caddy | The web server that terminates TLS, serves HTTP/3 and reverse proxies ([Caddy documentation](https://caddyserver.com/docs/)). |
| Caddyfile snippet | A named block of Caddyfile that sites import ([Caddyfile concepts](https://caddyserver.com/docs/caddyfile/concepts)). |
| `get_certificate` | The `tls` subdirective by which Caddy asks a manager, here a URL or `tailscale`, for the certificate of a handshake ([tls directive](https://caddyserver.com/docs/caddyfile/directives/tls)). |
| socket activation | Starting a service on the first connection to a socket that systemd holds ([systemd.socket](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html)). |
| DNS-01 | The ACME challenge that proves control of a name by a DNS record ([RFC 8555 section 8.4](https://www.rfc-editor.org/rfc/rfc8555#section-8.4)). |
| Tailscale certificate | A certificate for the Tailscale hostname of a node, issued through tailscaled ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)). |
| `route53:ChangeResourceRecordSets` | The Route 53 action that creates, replaces and deletes record sets, with a condition key that limits the record types and names of a change ([Condition keys for record sets](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/specifying-rrset-conditions.html)). |

## Services

A [Linux server](../overview.md#linux-server) MUST run the Tamanu services in the following table, each as a quadlet whose unit name is given.

| unit | server type | instances | image | command |
|---|---|---|---|---|
| `tamanu-frontend@<i>` | both | `a` and `b` | `ghcr.io/beyondessential/tamanu-frontend:<frontend version>` | the image default |
| `tamanu-central-api@<i>` | central | `1` and `2` | `ghcr.io/beyondessential/tamanu-central:<version>` | `startApi` |
| `tamanu-central-tasks` | central | one | `ghcr.io/beyondessential/tamanu-central:<version>` | `startTasks` |
| `tamanu-central-fhir-refresh` | central | one | `ghcr.io/beyondessential/tamanu-central:<version>` | `startFhirWorker --topics=fhir.refresh.allFromUpstream,fhir.refresh.entireResource,fhir.refresh.fromUpstream` |
| `tamanu-central-fhir-resolve` | central | one | `ghcr.io/beyondessential/tamanu-central:<version>` | `startFhirWorker --topics=fhir.resolver` |
| `tamanu-patientportal@<i>` | central, where the patient portal is enabled | `a` and `b` | `ghcr.io/beyondessential/tamanu-patient-portal:<version>` | the image default |
| `tamanu-facility-api@<i>` | facility | `1` and `2` | `ghcr.io/beyondessential/tamanu-facility:<version>` | `startApi` |
| `tamanu-facility-tasks` | facility | one | `ghcr.io/beyondessential/tamanu-facility:<version>` | `startTasks` |
| `tamanu-facility-sync` | facility | one | `ghcr.io/beyondessential/tamanu-facility:<version>` | `startSync` |

The patient portal MUST be enabled on a central server where the instance tag `PatientPortalFQDN` is set or the inventory variable `patient_portal_fqdn` is set, and MUST NOT be enabled on a facility server.

The Tamanu services of a server MUST run only the instances in the table.

Every Tamanu quadlet MUST have the properties in the following table.

| property | value |
|---|---|
| environment file | `/etc/tamanu/env` |
| image tag | `TAMANU_VERSION`, or `TAMANU_FRONTEND_VERSION` for the frontend, from the environment file |
| volume | `/etc/tamanu/<TAMANU_VERSION>` mounted at `/config` |
| volume | `/var/run/postgresql` mounted at `/var/run/postgresql` |
| sysctl | `net.ipv4.tcp_slow_start_after_idle=0` |
| restart | always, after 5 seconds |
| secret | `tamanu-config-key`, mounted with mode 0400 |
| install section | none |

A quadlet MUST NOT be enabled directly.

## Container runtime

A Linux server MUST run containers with Podman, using the crun runtime and the netavark network backend with the `nftables` firewall driver.

The default Podman network of a server MUST be a bridge with the interface `podman0`, DNS enabled, and the subnets in the following table.

| family | subnet | gateway | condition |
|---|---|---|---|
| IPv4 | `10.100.0.1/16` | `10.100.0.1` | always |
| IPv6 | `fd62:6573:b558:f686::1/64` | `fd62:6573:b558:f686::1` | the host has a default IPv6 route |

The inventory MAY override the subnets.

The container DNS server MUST listen on port 53 of the gateway.

The host resolver MUST route the search domain `tamanu.internal`, and `msupply.internal` where mSupply is enabled, to the container DNS server of `podman0`.

Containers MUST use the host time zone.

Where the inventory variable `tamanu_ipv6` is false, every Tamanu container MUST disable IPv6 in its network namespace.

Where the inventory variable `tamanu_extra_certs` is true, every Tamanu container MUST mount the host directory `/etc/ssl/certs` read-only at `/host/etc/ssl/certs` and set `NODE_EXTRA_CA_CERTS` to `/host/etc/ssl/certs/ca-certificates.crt`.

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

| path | mode and owner | written |
|---|---|---|
| `/etc/tamanu/env` | 0640, `tamanu:tamanu` | on every provisioning run |
| `/etc/tamanu/<version>/production.json5` | 0660, `tamanu:tamanu` | once per version, then preserved |
| `/etc/tamanu/<version>/local.json5` | 0440, `root:tamanu` | on every provisioning run |
| `/etc/tamanu/<version>/default.json5` | 0440, `tamanu:tamanu` | once per version, from the image |
| `/etc/tamanu/current` | a symbolic link to `/etc/tamanu/<version>` | on every provisioning run |

The file `/etc/tamanu/env` MUST contain the variables in the following table.

| variable | value |
|---|---|
| `TZ` | the inventory variable `timezone` |
| `PROXY_TRUSTED` | `loopback,linklocal,uniquelocal` |
| `TAMANU_VERSION` | the Tamanu version |
| `TAMANU_VERSION_DOMAIN` | the Tamanu version with every `.` replaced by `-` |
| `TAMANU_FRONTEND_VERSION` | the frontend version |
| `TAMANU_FRONTEND_VERSION_DOMAIN` | the frontend version with every `.` replaced by `-` |
| `DATABASE_URL` | a URL of the form `postgresql://<role>:<password>@/<database>?host=/var/run/postgresql` |

The file `production.json5` of a new version MUST be a copy of the `production.json5` of the version that `/etc/tamanu/current` names where one exists, and otherwise MUST be created from the seed of the server type in the following tables.

| key | value on a central server |
|---|---|
| `countryTimeZone`, `primaryTimeZone` | the inventory variable `timezone` |
| `canonicalHostName` | the inventory variable `tamanu_central_canonical_url` |
| `auth.secret`, `auth.refreshToken.secret` | values derived from the machine identifier and the credential seed |
| `auth.reportNoUserError` | `true` |
| `auth.useHardcodedPermissions` | `false` |
| `sync.lookupTable.enabled` | `true` |
| `db.reportSchemas.enabled` | `true` |
| `localisation.data.country` | the country name and the alpha-2 and alpha-3 codes of the inventory, which default to `Utopia`, `UT` and `UTO` |
| `localisation.data.timeZone` | the inventory variable `timezone` |
| `disk.freeSpaceRequired.gigabytesForUploadingDocuments` | `0.1` |
| `notifications.certificates.labTestCategoryIds` | `labTestCategory-COVID` and `labTestCategory-COVIDRAT` |

| key | value on a facility server |
|---|---|
| `countryTimeZone`, `primaryTimeZone` | the inventory variable `timezone` |
| `serverFacilityIds` | the facility identifier |
| `canonicalUrl` | `https://` followed by the public hostname |
| `sync.host` | the inventory variable `tamanu_central_canonical_url` |
| `sync.dynamicLimiter` | `initialLimit` 10000, `minLimit` 1000, `maxLimit` 100000, `optimalTimePerPageMs` 10000, `maxLimitChangePerPage` 0.3 |
| `auth.secret` | a value derived from the machine identifier and the credential seed |
| `auth.useHardcodedPermissions` | `false` |
| `survey.defaultCodes` | `department` and `location`, each defaulting to `GenericClinic` |
| `db.reportSchemas.enabled` | `true` |

The file `local.json5` MUST set the keys in the following table.

| key | value |
|---|---|
| `crypto.keyFile` | `/run/secrets/tamanu-config-key` |
| `proxy.trusted` | `loopback, linklocal, uniquelocal` |
| `db.name`, `db.username`, `db.password` | the database, its owner and the password of the owner |
| `db.host` | `/var/run/postgresql` |
| `db.port` | `null` |
| `db.migrateOnStartup` | `false` |
| `db.reportSchemas.connections.raw`, `db.reportSchemas.connections.reporting` | the user name and the derived password of the roles `raw` and `reporting` |
| `schedules.sendStatusToMetaServer.enabled` | `false`, where the installed [bestool](../overview.md#bestool) is version 1.8.0 or later |
| `disk.diskPath` | `/var/lib/postgresql`, on a central server |
| `patientPortal.portalUrl` | `https://` followed by the patient portal hostname, on a central server with the patient portal enabled |
| `sync.syncApiConnection` | host `http://syncapi.facility.tamanu.internal` and port 3000, on a facility server |

The file `local.json5` MUST NOT be edited by operators.

A facility server SHOULD resolve the hostname of its central server to the address in the inventory variable `tamanu_central_ip` where that is set, by an entry in `/etc/hosts`.

A facility server MUST NOT have an `/etc/hosts` entry for the hostname of its central server that was not written for `tamanu_central_ip`.

## Server key

Each Tamanu server MUST have a [server key](../overview.md#server-key), held as the podman secret `tamanu-config-key`.

The server key MUST be 32 bytes read from the kernel random source, and MUST NOT pass through the control host or an inventory variable.

An existing server key MUST NOT be replaced by provisioning.

The server key MUST be mounted into every Tamanu container at `/run/secrets/tamanu-config-key` with mode 0400.

> [!NOTE]
> A value that Tamanu encrypted under one server key cannot be decrypted under another.

## Inventory variables

The variables in the following table configure a Tamanu server.

| variable | default | meaning |
|---|---|---|
| `timezone` | none | The time zone of the host and of Tamanu. |
| `salt` | none | The credential seed. |
| `tamanu_central_canonical_url` | none | The URL that facility servers synchronise against. |
| `tamanu_version` | `v2.10.0` | The image tag of the backend and patient portal. |
| `tamanu_frontend_version` | `tamanu_version` | The image tag of the frontend. |
| `tamanu_allow_downgrade` | `false` | Permits a version lower than the deployed version. |
| `public_hostname` | none | The primary hostname of the server. |
| `tamanu_facility_id` | none | The facility identifier of a facility server. |
| `patient_portal_fqdn` | none | The patient portal hostname of a central server. |
| `tamanu_central_ip` | `false` | An address for the central hostname on a facility server. |
| `tamanu_caddy_tls` | `true` | Whether the proxy serves HTTPS on the public hostname. |
| `tamanu_caddy_extra_hostnames` | none | Additional hostnames that the proxy serves. |
| `tamanu_caddy_extra_hostnames_redirect` | `true` | Whether additional hostnames redirect to the public hostname. |
| `tamanu_tailscale_tls` | `true` | Whether the proxy serves HTTPS on the Tailscale hostname. |
| `tailnet` | `tail53aef` | The tailnet name used to form Tailscale hostnames. |
| `tamanu_ipv6` | `true` | Whether containers have IPv6. |
| `tamanu_extra_certs` | `false` | Whether containers trust the host certificate store. |
| `tamanu_default_department`, `tamanu_default_location` | `GenericClinic` | The survey default codes of a facility server. |
| `tamanu_country_name`, `tamanu_country_alpha2`, `tamanu_country_alpha3` | `Utopia`, `UT`, `UTO` | The country of a central server. |
| `tamanu_caddy_tls_dns_iam` | none | The Route 53 credentials of an external server, with `access_key_id` and `secret_access_key`. |
| `caddy_zerossl_api_key` | none | A ZeroSSL API key that selects ZeroSSL as an additional issuer. |
| `caddy_canopy_certificates` | `true` | Whether sites ask the [alert daemon](../overview.md#alert-daemon) for certificates. |
| `elastic_agent_enabled`, `elastic_agent_enrollment_token`, `elastic_agent_fleet_url` | `false`, none, the production Fleet | The endpoint security agent of [LNXSRV](server.md#endpoint-security-agent). |
| `msupply_enabled`, `msupply_hostname`, `msupply_tailscale_service` | derived from instance tags | The mSupply service. |
| `ufw_managed`, `dangerously_leave_ufw_alone` | `false`, `false` | The host firewall of [LNXSRV](server.md#host-firewall). |
| `munin_enabled` | `true` | Whether the Munin node runs. |

A variable whose name is a secret variable of the group in [Canopy](../overview.md#canopy) MUST NOT also be a tag of a host.

## Versions

The backend version of a server MUST be the value of `tamanu_version`, and the frontend version MUST be the value of `tamanu_frontend_version`.

The installed [bestool](../overview.md#bestool) MUST be at least version 1.21.0 before Tamanu is installed or upgraded.

The images of a version MUST be pulled before the environment file names the version.

Provisioning MUST refuse to set a backend version, or a frontend version, that is lower than the deployed version, where both are `v`-prefixed versions, unless `tamanu_allow_downgrade` is true.

A frontend version that is not a `v`-prefixed version MUST NOT be compared.

## Upgrades

An upgrade MUST be run only against an inventory that was read with the intent `upgrade`.

An upgrade MUST perform the steps in the following table, in order.

| step | action |
|---|---|
| 1 | Provision the server at the new version, as for an install, which pulls the images, writes the version directory and the environment file, and writes the proxy configuration. |
| 2 | Stop the API, tasks, sync and FHIR services of the server type, leaving the frontend serving. |
| 3 | Restart the frontend instances, and the patient portal instances on a central server, one instance at a time behind a readiness check and a proxy reload. |
| 4 | Stop any frontend or patient portal instance other than `a` and `b`, and reload the proxy. |
| 5 | Drop the schema `reporting` with its contents. |
| 6 | Run the database migrations of the new version. |
| 7 | Create the schema `reporting`, owned by `tamanu`. |
| 8 | Start every service that should be running, and reload the proxy. |
| 9 | Remove every Tamanu image whose tag is neither the new nor the previous backend version and neither the new nor the previous frontend version. |

A frontend-only upgrade MUST leave the backend version at the deployed value, and MUST perform steps 3, 4 and 9 for the frontend alone after pulling the frontend image and writing the environment file.

A frontend-only upgrade MUST refuse to run where `/etc/tamanu/env` has no `TAMANU_VERSION`.

A helper `/usr/local/bin/tamanu-run` MUST run a command in a container of the server image for a version named on its command line, or for the current version, with the configuration of that version at `/config`, the PostgreSQL socket directory, the environment file and the server key.

The helper MUST fail with an explanation where the server key does not exist.

## Boot and restart

A Linux server MUST bring up every Tamanu service that should be running when it boots, by a oneshot unit that is ordered after `network-online.target`.

A Linux server MUST roll its running Tamanu services when PostgreSQL starts, by a oneshot unit wanted by PostgreSQL and ordered after it.

The rolling unit MUST run only where a frontend instance is active.

The rolling unit MUST NOT bind the lifetimes of the Tamanu services to PostgreSQL.

A roll MUST keep at least one critical instance serving while it restarts API and frontend instances one at a time, and MAY restart the other services together.

> [!NOTE]
> A restart of PostgreSQL severs the pooled connections of every service.
> A hard dependency would stop and start every service together with PostgreSQL and drop traffic.

## Reverse proxy

A Linux server MUST run the proxy, Caddy, from the BES package, held against unattended upgrade at the version of the inventory, which is `2.11.4-bes1` unless the inventory sets another.

The proxy MUST be started by socket activation on `[::]:80` and `[::]:443` over TCP and `[::]:443` over UDP, and its service unit MUST NOT be enabled directly.

The proxy MUST run in the critical resource class and start after the alert daemon.

The proxy MUST read its site configuration from the directories in the following table.

| directory | holds |
|---|---|
| `/etc/caddy/snippets` | `tamanu-upstreams` and `tamanu-common`, the snippets that the servers import |
| `/etc/caddy/servers` | `tamanu`, `tamanu-patientportal`, `msupply` and `munin`, one site file each |
| `/etc/caddy/config` | `issuer` and `metrics` |

The proxy MUST write the log directory `/var/log/caddy` with mode 0750 from its service unit.

The proxy MUST raise the kernel receive and send buffer maxima for UDP, `net.core.rmem_max` and `net.core.wmem_max`, to 2500000 bytes.

The proxy MUST serve the sites in the following table.

| site | served where | behaviour |
|---|---|---|
| any host over HTTP | always | serves Tamanu |
| `https://<public hostname>` | `tamanu_caddy_tls` is true and the hostname does not end in `.local` | serves Tamanu with a certificate that [Certificates](#certificates) gives |
| `http://<public hostname>` | `tamanu_caddy_tls` is true and the hostname does not end in `.local` | redirects with status 308 to HTTPS |
| `https://<Tailscale name>.<tailnet>.ts.net` | the server has a Tailscale name and `tamanu_tailscale_tls` is true | serves Tamanu with a Tailscale certificate |
| an extra hostname | listed in `tamanu_caddy_extra_hostnames` | redirects with status 308 to the public hostname where `tamanu_caddy_extra_hostnames_redirect` is true, otherwise serves Tamanu on its own certificate |
| `https://<patient portal hostname>` | the patient portal is enabled and the hostname does not end in `.local` | serves the patient portal |

An extra hostname that ends in `.local`, or any extra hostname where `tamanu_caddy_tls` is false, MUST be served over HTTP only.

The Tamanu sites MUST behave as the following table gives.

| behaviour | value |
|---|---|
| frontend upstream | `frontend.tamanu.internal` port 3000, resolved through the container DNS server, IPv4 only, with the request header `Host` set to `localhost` |
| API upstream | `api.<server type>.tamanu.internal` port 3000, resolved through the container DNS server, IPv4 only |
| patient portal upstream | `patientportal.tamanu.internal` port 3000, resolved through the container DNS server, IPv4 only, with the request header `Host` set to `localhost` |
| balancing | least connections, with 2 retries over at most 5 seconds |
| upstream transport | keep-alive of 90 seconds, no compression |
| API paths | `/v1/*` and `/api/*` |
| API rate limit | 1000 events per second for each client address |
| login rate limit | 10 events per second for each client address on `/api/login` |
| API responses | `Cache-Control: no-store` |
| `/` | `Cache-Control: no-cache` |
| `/manifest.json` | `Cache-Control: no-cache` |
| `/env.js` | the upstream response with `Cache-Control: public, max-age=604800, immutable` |
| `/v1/login` | redirect with status 308 to `/api/login` |
| HTTP/1.1 requests without an `Upgrade` header | response headers `Connection: keep-alive` and `Keep-Alive: timeout=90` |
| response encoding | `zstd` and `gzip` |
| error pages | `/resources/errors/<status>.html` where the file exists |
| socket paths | `/socket.io*` and `/api/socket.io*` answer 405, where the Tamanu version is lower than 2.48.0 |
| access log | JSON with RFC 3339 nanosecond timestamps in `/var/log/caddy/access.log`, rolled at 100 MiB, keeping 10 files, shared by every site |
| metrics | enabled, with a series per host |
| web application firewall | the proxy imports the files `waf*` from `/etc/caddy/servers` where they exist |

The proxy's upstream resolver MUST be the gateway of the default Podman network.

## Certificates

A hostname that the proxy serves over HTTPS MUST have a certificate from the source that the following table gives.

| hostname | certificate source |
|---|---|
| the public hostname, the patient portal hostname, the mSupply hostname, and an extra hostname that does not redirect | the alert daemon's certificate endpoint, then the proxy's issuer for any name the daemon declines |
| an extra hostname that redirects | the proxy's issuer |
| the Tailscale hostname | tailscaled |

The alert daemon's certificate endpoint MUST be `http://127.0.0.1:8271/certificate`.

A site MUST name the certificate endpoint only where the installed bestool is version 2.2.0 or later and `caddy_canopy_certificates` is true.

The alert daemon MUST admit, for its certificate endpoint, only `root` and the user `caddy`.

A site MUST NOT name the certificate endpoint before the alert daemon admits `caddy`.

Certificates that the alert daemon serves are issued by [Canopy](../overview.md#canopy), as [CTLS](../canopy/tls-issuance.md) specifies.

The proxy's issuer MUST be an ACME issuer with the contact address `tls-renewal@bes.au`.

The proxy's issuer MUST use ZeroSSL as well where `caddy_zerossl_api_key` is set.

The proxy's issuer MUST use [DNS-01](#borrowed-terms) through Route 53, with up to 10 retries, where `tamanu_caddy_tls_dns_iam` is set.

The proxy MUST read the Route 53 credentials from `/var/lib/caddy/.aws/credentials`, in the profile `default`, owned by `caddy` with mode 0600 in a directory with mode 0700.

The file and directory of the Route 53 credentials MUST be removed where `tamanu_caddy_tls_dns_iam` is not set.

The proxy MUST be permitted to use tailscaled's certificates by `TS_PERMIT_CERT_UID=caddy` in `/etc/default/tailscaled`.

An external server MUST have an IAM user for DNS-01, whose managed policy and inline policy are those in the following table.

| policy | actions | resource | condition |
|---|---|---|---|
| managed, shared by all such users | `route53:ListHostedZones`, `route53:ListHostedZonesByName`, `route53:GetChange` | all | none |
| inline | `route53:ChangeResourceRecordSets` | the hosted zone of the core | record type `TXT` only, and only at `_acme-challenge.<name>` for the server hostname, the mSupply hostname where set, and the patient portal hostname on a central server |
| inline | `route53:ListResourceRecordSets` | the hosted zone of the core | none |

The IAM user MUST NOT be given access keys by infrastructure code.

A server MAY be given an IAM user for DNS-01 by configuration, whether or not it is an external server.

## mSupply

A facility server MUST run mSupply where the instance tag `MsupplyFQDN` is set or the inventory variable `msupply_enabled` is true.

mSupply MUST run as the quadlet `msupply` from the image `docker.io/msupplyfoundation/omsupply:<tag>`, whose tag is the inventory's `msupply_version_arm64` on an arm64 host and `msupply_version_amd64` otherwise.

mSupply MUST run as the system user `msupply`, with its database in `/var/lib/msupply` with mode 0770, and its configuration in `/etc/msupply/env` and `/etc/msupply/local.yaml`.

mSupply MUST be reachable on port 8000 at the network alias `api.msupply.internal`.

mSupply MUST publish port 8000 on `127.0.0.1` where it has a Tailscale service, on all addresses where it has neither a hostname nor a Tailscale service, and otherwise not at all.

Where mSupply has a hostname, the proxy MUST serve it as an HTTPS site that reverse proxies to the alias on port 8000, and MUST NOT serve that site where it has none.

Where mSupply has a Tailscale service, the server MUST serve that service from the Tailscale node after the node is ready.

An mSupply upgrade MUST restart the mSupply service and reload the proxy.

Where the host firewall is managed and mSupply has no hostname, the firewall MUST allow TCP port 8000.

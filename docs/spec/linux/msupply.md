---
id: LNXMSP
---

# mSupply on a Linux server

The requirements in this spec apply to an mSupply instance on a [Linux server](../overview.md#linux-server).
The container network, reverse proxy and certificates that mSupply uses are those of the server, which [LNXRUN](runtime.md) and [LNXTLS](tls.md) specify.

## Borrowed terms

| term | meaning |
|---|---|
| quadlet | A systemd unit generated from a `.container` file that describes a Podman container ([podman-systemd.unit](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)). |
| network alias | A name under which the other containers of a Podman network resolve a container ([podman-systemd.unit](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)). |
| Tailscale service | A name on the tailnet, not tied to one node, that a node advertises with Tailscale serve ([Tailscale Services](https://tailscale.com/kb/1552/tailscale-services), [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve)). |

## Enablement

A server MUST run mSupply where the inventory variable `msupply_enabled` is true.
Where `msupply_enabled` is not set, a server MUST run mSupply where the [instance tag](../overview.md#instance-tags) `MsupplyFQDN` is set.

The variables in the following table configure mSupply.

| variable | default | meaning |
|---|---|---|
| `msupply_enabled` | none | Whether the server runs mSupply. |
| `msupply_hostname` | none | The hostname that the proxy serves mSupply on. |
| `msupply_tailscale_service` | none | The Tailscale service that the server advertises for mSupply. |
| `msupply_version_amd64`, `msupply_version_arm64` | selected by the playbooks | The image tag of mSupply on an amd64 and an arm64 host. |

Where the instance tag `MsupplyFQDN` is set, its value MUST be the hostname of mSupply, whatever `msupply_hostname` holds.
Where `msupply_tailscale_service` is set, it MUST take precedence over the instance tag `MsupplyTailscaleService`.
The value of the Tailscale service MAY omit the prefix `svc:`.

## Provisioning

The mSupply hostname of a server MUST be `msupply.<subdomain>.<domain base>`, or `<prefix>.<domain base>` where a prefix is configured, where the subdomain and the domain base are those of [LNXAWS](aws.md#naming).

The mSupply Tailscale service of a server MUST be named `svc:<Tailscale name>-svc-msupply`.

A deployment MUST publish a CNAME record from the mSupply hostname to the hostname of its server, with a time to live of 300 seconds.

An instance of a server that has mSupply configured MUST carry the instance tags in the following table.

| tag | value |
|---|---|
| `MsupplyFQDN` | the mSupply hostname |
| `MsupplyTailscaleService` | the mSupply Tailscale service name |

The playbooks MUST read the instance tags `MsupplyFQDN` and `MsupplyTailscaleService` as [LNXAWS](aws.md#instance-tags) requires of the other instance tags.

## Service

mSupply MUST run as the quadlet `msupply` from the image `docker.io/msupplyfoundation/omsupply:<tag>`, whose tag is the value of `msupply_version_arm64` on an arm64 host and of `msupply_version_amd64` otherwise.

The unit `msupply` MUST start at boot, and MUST restart whenever it exits.

mSupply MUST run as the system user `msupply`, with its database in `/var/lib/msupply` with mode 0770, and its configuration in `/etc/msupply/env` and `/etc/msupply/local.yaml`.

mSupply MUST be reachable at the network alias `api.msupply.internal`.

The host resolver MUST route names under `msupply.internal` to the container DNS server of [LNXRUN](runtime.md#container-runtime).

mSupply MUST publish its service port as the following table gives.

| mSupply has | the service port is published on |
|---|---|
| a Tailscale service | `127.0.0.1` |
| neither a hostname nor a Tailscale service | all addresses |
| a hostname and no Tailscale service | no address |

Where the host firewall is managed and mSupply has no hostname, the firewall MUST allow the service port of mSupply.

## Proxy site

Where mSupply has a hostname, the proxy MUST serve it as an HTTPS site that reverse proxies to the network alias, resolving it as [LNXRUN](runtime.md#reverse-proxy) requires of upstream names.

Where mSupply has a hostname, the proxy MUST redirect HTTP requests for it to HTTPS with status 308.

The site MUST be the file `/etc/caddy/servers/msupply`, and the proxy MUST NOT serve that site where mSupply has no hostname.

The certificate of the site is given by [LNXTLS](tls.md).

## Tailscale service

Where mSupply has a Tailscale service, the server MUST advertise that service from its Tailscale node once the node is ready.

The advertised service MUST forward HTTPS on port 443 and HTTP on port 80 to the service port of mSupply on the loopback address.

## Installation and upgrades

The installation playbook of [LNXANS](ansible.md#playbooks) MUST set up mSupply on every server where it is enabled, and MUST be selectable with the tag `msupply`.

The upgrade playbook of [LNXANS](ansible.md#upgrades) MUST restart the mSupply service and reload the proxy on every server where mSupply is enabled.

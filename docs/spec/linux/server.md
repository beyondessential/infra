---
id: LNXSRV
---

# Linux server baseline

The requirements in this spec apply to the baseline that the Ansible setup of [LNXANS](ansible.md) keeps on every [Linux server](../overview.md#linux-server).
The provisioning of servers in AWS is specified by [LNXAWS](aws.md), the database by [LNXDB](database.md), the Tamanu services and their proxy by [LNXRUN](runtime.md), and backups by [LNXBAK](backups.md).

## Borrowed terms

| term | meaning |
|---|---|
| BES Linux image | The disk image that BES's linux-images repository builds, in the variants `metal`, `cloud` and `pi` ([disk images](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#variants)). |
| instance | An EC2 instance ([Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Instances.html)). |
| Tailscale tag | An ACL tag that identifies a tailnet node by its role instead of its user ([Tailscale tags](https://tailscale.com/kb/1068/tags)). |
| Tailscale SSH | SSH access to a node that tailscaled authenticates and authorises from the tailnet policy ([Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh)). |
| btrfs subvolume | A separately mountable and snapshottable tree inside a btrfs filesystem ([btrfs subvolumes](https://btrfs.readthedocs.io/en/latest/Subvolumes.html)). |
| slice | A systemd unit that groups services in the control group hierarchy so that resources are divided among groups ([systemd.slice](https://www.freedesktop.org/software/systemd/man/latest/systemd.slice.html)). |
| CPUWeight, IOWeight, MemoryMin | The resource-control settings that share CPU time and I/O among slices and protect memory from reclaim ([systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)). |
| journald | The systemd journal, whose storage mode and size cap are set in `journald.conf` ([journald.conf](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html)). |
| chrony | The NTP implementation that keeps the system clock ([chrony documentation](https://chrony-project.org/documentation.html)). |
| BBR | The TCP congestion control algorithm, selected with `net.ipv4.tcp_congestion_control` ([IP sysctl](https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html)). |
| ufw | The Uncomplicated Firewall front end to the kernel packet filter ([UFW](https://help.ubuntu.com/community/UFW)). |
| Munin | The graphing system whose node daemon collects plugin metrics ([Munin](https://munin-monitoring.org/)). |

## Platform

A Linux server MUST be either a [central server](../overview.md#central-server) or a [facility server](../overview.md#facility-server).

A facility server MUST have a facility identifier.

A Linux server MUST run Ubuntu 24.04 or later.

A Linux server MAY have an amd64 or an arm64 processor.

A Linux server MAY be built from a [BES Linux image](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#variants).

A server built from a BES Linux image satisfies the requirements of this spec that cite an image requirement through the image.

A Linux server SHOULD have a btrfs root filesystem with the subvolume `@` mounted at `/`, as [`image.btrfs.format`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#btrfs-configuration) and [`image.btrfs.subvolumes`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#btrfs-configuration) require of an image.

A Linux server whose root filesystem is not btrfs MUST still be managed by the playbooks, with the behaviour that depends on btrfs skipped.

A Linux server MUST be able to reach the hosts in the following table over HTTPS.

| host | purpose |
|---|---|
| `meta.tamanu.app` | Tamanu's meta server. |
| `tools.ops.tamanu.io` | The BES package repository and tool downloads. |
| `clients.ops.tamanu.io` | Client downloads. |
| `servers.ops.tamanu.io` | Server downloads. |
| `ghcr.io` | The container registry that holds the Tamanu images. |

A Linux server SHOULD be able to send and receive UDP on port 123 to reach NTP servers.

A Linux server SHOULD have IPv6 enabled at the kernel and have a link-local IPv6 address.

A Linux server SHOULD have Tailscale installed and `tailscaled` enabled, as [`image.packages.tailscale`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#packages) and [`image.tailscale.service-enabled`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#tailscale) require of an image.

Where a Linux server has a Tailscale name, the playbooks MUST install Tailscale on it and enable `tailscaled`.

## Storage layout

A Linux server SHOULD have the single layout, in which `/var/log` is on the root volume and `/var/lib/postgresql` is the btrfs subvolume `@postgres` of the root volume, as [`image.btrfs.subvolumes`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#btrfs-configuration) requires of an image.

[LNXDB](database.md#data-directory) specifies the data directory of the single layout.

A Linux server MAY have the [split layout](../overview.md#split-layout), in which `/var/log` and `/var/lib/postgresql` are separate volumes.

Where an instance carries the [instance tag](../overview.md#instance-tags) `Partitioning` with the value `split-data-logs`, the playbooks MUST set up the volumes in the following table.

| volume | device alias | mount point | filesystem | mount options |
|---|---|---|---|---|
| logs | `sdl` | `/var/log` | btrfs | `defaults,compress=zstd:6` |
| data | `sdp` | `/var/lib/postgresql` | btrfs | `defaults,noatime,discard` |

A volume of the split layout MUST be located by the device alias that its attachment names, not by a kernel device name.

A volume of the split layout MUST be formatted only where it holds no filesystem.

Existing files at a mount point of the split layout MUST be copied to the volume before the volume is mounted over them.

The filesystem of a volume of the split layout SHOULD be grown to fill the volume.

Where a Linux server has a swap file on a btrfs root, the swap file MUST be a file in a subvolume that has copy-on-write disabled, at `/.swap/swap.img`.

A btrfs root SHOULD be balanced weekly and scrubbed monthly, in the background [resource class](#resource-classes).

## Access

Where a Linux server has a Tailscale name, it MUST be a member of the tailnet under that name, advertising its Tailscale tags and accepting Tailscale SSH.

The first boot of an instance joins it to the tailnet, as [LNXAWS](aws.md#first-boot) requires.

The login user of a Linux server MUST be a member of the group `tamanu`.

A Linux server SHOULD provide a helper that runs the command that joins the tailnet with the server's name, tags and login user as parameters.

Where the login user is not `ubuntu`, the profile of the user `ubuntu` SHOULD print a warning that names the login user, on SSH sessions only.

## Package sources and updates

A Linux server MUST be configured with the package repositories in the following table.

| repository | pin priority | provides |
|---|---|---|
| `https://tools.ops.tamanu.io/apt stable main` | 999 for every package from the origin | [bestool](../overview.md#bestool), `caddy`, `podman`, `crun` and `kopia`; the repository that [`image.packages.bes-tools`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#packages) requires of an image |
| `https://apt.postgresql.org/pub/repos/apt <release>-pgdg main` | 900 | PostgreSQL |
| `https://pkgs.tailscale.com/stable/ubuntu <release> main` | 900 | Tailscale; the repository that [`image.packages.tailscale`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#packages) requires of an image |
| `https://artifacts.elastic.co/packages/9.x/apt stable main` | 900 | The Elastic Agent, where it is enabled |

The playbooks MUST configure each repository in the table on a server that is not built from an image.

A Linux server MUST have each repository's signing key installed under `/etc/apt/keyrings` or `/usr/share/keyrings` and name it in `signed-by`.

A Linux server SHOULD refresh its package lists daily in the background resource class.

A Linux server SHOULD upgrade the packages in the following table on the schedule given for each.

| package | schedule |
|---|---|
| `bestool` | daily |
| `openssh-server` | weekly |
| `tzdata` | weekly |
| `tailscale` | weekly, as [`image.tailscale.auto-update`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#tailscale) requires of an image |

A Linux server SHOULD restart a service whose executable, or a shared library that it has mapped, a package operation replaced, as [`image.packages.service-restart`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#packages) requires of an image.

## Time and names

A Linux server MUST synchronise its clock with chrony, as [`image.packages.chrony`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#packages) requires of an image.

A Linux server MUST NOT run `systemd-timesyncd`.

The playbooks MUST install and enable chrony, and stop and mask `systemd-timesyncd`, on a server that is not built from an image.

A Linux server MUST use the source `pool.ntp.org`.

An instance MUST additionally use the Amazon Time Sync Service at `169.254.169.123`, preferred.

A Linux server MUST set its time zone to the inventory variable `timezone`.

The hostname of a Linux server MUST be its public hostname with any trailing `.local` removed.

A Linux server SHOULD resolve its own hostname, with and without the trailing `.local`, from `/etc/hosts` and from `myhostname` before any DNS query.

A Linux server MUST use systemd-resolved as its resolver through `/etc/resolv.conf` pointing at the resolved stub file, as [`image.base.resolver`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#base-system) requires of an image.

The playbooks MUST install and enable systemd-resolved, and point `/etc/resolv.conf` at its stub file, on a server that is not built from an image.

## Logging

A Linux server MUST configure journald to keep the journal on persistent storage, capped at 1 GiB.

## Network tuning

A Linux server SHOULD select BBR with the `fq` queue discipline.

A Linux server SHOULD disable TCP slow start after idle.

## Resource classes

A Linux server MUST define the three [resource classes](../overview.md#resource-class) in the following table as slices.

| class | slice | CPUWeight | IOWeight | MemoryMin |
|---|---|---|---|---|
| critical | `critical.slice` | 200 | 200 | 512M |
| elevated | `elevated.slice` | 150 | 150 | none |
| background | `background.slice` | 20 | 20 | none |

A Linux server MUST run the services in the following table in the resource class given for each.

| service | class |
|---|---|
| PostgreSQL | critical |
| Caddy | critical |
| the Tamanu API instances | critical |
| the Tamanu sync service of a facility server | elevated |
| the Tamanu FHIR workers of a central server | elevated |
| package refreshes, btrfs balance and scrub, and image pruning | background |

PostgreSQL SHOULD restart on failure after 30 seconds.

PostgreSQL SHOULD continue running when one of its processes is killed for lack of memory.

Caddy and the Tamanu API instances SHOULD be less likely than other processes to be chosen by the kernel's out-of-memory killer.

A Linux server MUST enable systemd accounting of CPU, I/O, IP, memory and tasks by default for all units.

A Linux server SHOULD use the bfq I/O scheduler on every disk.

> [!NOTE]
> I/O weights only take effect under a scheduler that honours cgroup I/O weight, and the default schedulers do not.

## Kernel hardening

A Linux server SHOULD prevent the kernel modules in the following table from loading, and SHOULD unload any that are loaded.

| module |
|---|
| `esp4` |
| `esp6` |
| `rxrpc` |
| `rds` |
| `rds_tcp` |

## Host firewall

A Linux server SHOULD manage its host firewall.

A Linux server on which the host firewall is not managed MUST have it stopped and disabled, unless the server's inventory sets `dangerously_leave_ufw_alone`.

A managed host firewall MUST use the default policies in the following table.

| direction | policy |
|---|---|
| incoming | deny |
| routed | deny |

A managed host firewall MUST allow the traffic in the following table.

| traffic | condition |
|---|---|
| TCP 80, TCP 443 and UDP 443 from any source | always |
| forwarded traffic in from `podman0` | always |
| DNS (port 53) in from `podman0` | always |
| every packet in from `tailscale0` | the server is a member of the tailnet |
| SSH from `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `fc00::/7` | the server is a member of the tailnet |
| SSH from any source | the server is not a member of the tailnet |

A managed host firewall MUST NOT allow SSH from any source where the server is a member of the tailnet.

The SSH port MUST be the port that the SSH daemon is configured to listen on.

## Metrics

A Linux server SHOULD run the Munin node, bound to `127.0.0.1`.

A Linux server that runs the Munin node SHOULD serve the Munin graphs over HTTPS on its Tailscale hostname at TCP port 4950, from `/var/cache/munin/www`.

The Munin data directory `/var/lib/munin` on a btrfs filesystem SHOULD be a subvolume with copy-on-write disabled.

Where the Munin node is installed, a Linux server SHOULD enable the Munin plugins of its database and of Caddy.

The Munin plugin of the [bestool daemon](../overview.md#bestool-daemon) is specified by bestool's [metrics](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/metrics.md#the-endpoint).

## Endpoint security agent

A Linux server MAY run the Elastic Agent, enrolled in a Fleet at a configurable URL with an enrolment token that is a secret variable.

A Linux server on which the agent is disabled, or has no enrolment token, MUST have the agent stopped and removed with its data directory `/opt/Elastic`.

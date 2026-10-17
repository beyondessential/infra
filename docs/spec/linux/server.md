---
id: LNXSRV
---

# Linux server hosts

The requirements in this spec apply to every [Linux server](../overview.md#linux-server), and to the cloud infrastructure that provisions it.
The database is specified by [LNXDB](database.md), the Tamanu services and their proxy by [LNXRUN](runtime.md), their installation by [LNXANS](ansible.md), and backups by [LNXBAK](backups.md).

## Borrowed terms

| term | meaning |
|---|---|
| cloud-init | The first-boot configuration mechanism of cloud images, which runs a list of commands from instance user data ([cloud-init documentation](https://cloudinit.readthedocs.io/en/latest/)). |
| IMDSv2 | The session-oriented method of the EC2 instance metadata service ([Amazon EC2 instance metadata service configuration](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)). |
| instance metadata tags | The exposure of an instance's EC2 tags through the instance metadata service ([Work with instance tags in instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/work-with-tags-in-IMDS.html)). |
| gp3 | The general-purpose SSD volume type of EBS ([General purpose SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html)). |
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
| AWS Backup | The AWS service that snapshots instances and volumes under backup plans ([What is AWS Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)). |

## Server types

A Linux server MUST be either a [central server](../overview.md#central-server) or a [facility server](../overview.md#facility-server).

A Linux server MUST run the Tamanu services that [LNXRUN](runtime.md#services) assigns to its type.

A facility server MUST have a facility identifier.

A deployment's central server and facility servers MUST be managed from one inventory, in which a central server is a member of the group `central` and a facility server is a member of the group `facility`.
The inventory is specified by [LNXANS](ansible.md#inventory).

## Platform

A Linux server MUST run Ubuntu 24.04 or later.

A Linux server SHOULD have a btrfs root filesystem mounted from the subvolume `@`.

A Linux server whose root filesystem is not btrfs MUST still be managed by the playbooks, with the behaviour that depends on btrfs skipped.

A Linux server MAY have an amd64 or an arm64 processor.

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

A Linux server SHOULD have Tailscale installed.

## Storage layout

A Linux server that is an instance MUST use one of the layouts in the following table.

| layout | root | `/var/log` | `/var/lib/postgresql` |
|---|---|---|---|
| single | btrfs volume | on the root volume | the btrfs subvolume `@postgres` of the root volume, as [LNXDB](database.md#data-directory) specifies |
| [split](../overview.md#split-layout) | btrfs volume | a separate btrfs volume mounted with `defaults,compress=zstd:6` | a separate btrfs volume mounted with `defaults,noatime,discard` |

A Linux server that is an instance MUST use the layout that its instance tag `Partitioning` names.

A volume of the split layout MUST be located by the device alias that its attachment names, not by a kernel device name.

A volume of the split layout MUST be formatted only where it holds no filesystem.

Existing files at a mount point MUST be copied to the volume before the volume is mounted over them.

The filesystem of a volume of the split layout SHOULD be grown to fill the volume.

A swap file on a btrfs root MUST be a file in a subvolume that has copy-on-write disabled, at `/.swap/swap.img`.

A btrfs root SHOULD be balanced weekly with data and metadata usage filters of 50%.

A btrfs root SHOULD be scrubbed monthly.

The balance and the scrub MUST run in the background [resource class](#resource-classes), at nice level 19 and the idle I/O scheduling class.

## Access

Where a Linux server has a Tailscale name, it MUST be a member of the tailnet under that name, advertising its Tailscale tags and accepting Tailscale SSH.

The login user of a Linux server MUST be a member of the group `tamanu`.

A Linux server SHOULD provide a helper that runs the command that joins the tailnet with the server's name, tags and login user as parameters.

An instance MUST carry the fixed emergency public key `emergency@tamanu` in the authorized keys of the user `ubuntu`.

> [!NOTE]
> The emergency key is one key for every deployment.
> It is the only access to an instance whose Tailscale membership has failed.

Where the login user is not `ubuntu`, the profile of the user `ubuntu` SHOULD print a warning that names the login user, on SSH sessions only.

## Package sources and updates

A Linux server MUST be configured with the package repositories in the following table.

| repository | pin priority | provides |
|---|---|---|
| `https://tools.ops.tamanu.io/apt stable main` | 999 for every package from the origin | [bestool](../overview.md#bestool), `caddy`, `podman`, `crun` and `kopia` |
| `https://apt.postgresql.org/pub/repos/apt <release>-pgdg main` | 900 | PostgreSQL |
| `https://pkgs.tailscale.com/stable/ubuntu <release> main` | 900 | Tailscale |
| `https://artifacts.elastic.co/packages/9.x/apt stable main` | 900 | The Elastic Agent, where it is enabled |

A Linux server MUST have each repository's signing key installed under `/etc/apt/keyrings` or `/usr/share/keyrings` and name it in `signed-by`.

A Linux server SHOULD refresh its package lists daily in the background resource class.

A Linux server SHOULD upgrade the packages in the following table on the schedule given for each.

| package | schedule |
|---|---|
| `bestool` | daily |
| `openssh-server` | weekly |
| `tzdata` | weekly |
| `tailscale` | weekly |

A Linux server SHOULD install `needrestart` so that services restart when a package they depend on updates.

A Linux server SHOULD have the operator tools of the toolbox installed: a Tailscale-aware `w`, a terminal multiplexer configuration, a process monitor configuration, a prompt, and the editor `edit`.

## Time and names

A Linux server MUST synchronise its clock with chrony.

A Linux server MUST use the source `pool.ntp.org`.

An instance MUST additionally use the Amazon Time Sync Service at `169.254.169.123`, preferred, with a polling interval of 16 seconds.

A Linux server MUST NOT run `systemd-timesyncd`.

A Linux server MUST set its time zone to the inventory variable `timezone`.

A Linux server SHOULD generate the locales `en_US`, `en_AU`, `en_GB` and `en_NZ`, each in UTF-8.

The hostname of a Linux server MUST be its public hostname with any trailing `.local` removed.

A Linux server SHOULD resolve its own hostname, with and without the trailing `.local`, from `/etc/hosts` and from `myhostname` before any DNS query.

A Linux server MUST use systemd-resolved as its resolver through `/etc/resolv.conf` pointing at the resolved stub file.

The resolver service SHOULD be limited to a CPU weight of 20 and a CPU quota of 30%.

## Logging

A Linux server MUST keep its journal on persistent storage, capped at 1 GiB.

A Linux server SHOULD record a timestamp in the format `%F %T` with each bash history entry.

Where rsyslog is installed, a Linux server SHOULD omit the programs `caddy`, `bestool-alertd` and `aardvark-dns`, and the program prefixes `systemd-tamanu` and `systemd-msupply`, from its syslog output.

## Network tuning

A Linux server SHOULD select BBR with the `fq` queue discipline, loading the BBR module at boot.

A Linux server SHOULD disable TCP slow start after idle.

## Resource classes

A Linux server MUST define the three [resource classes](../overview.md#resource-class) in the following table as slices.

| class | slice | CPUWeight | IOWeight | MemoryMin |
|---|---|---|---|---|
| critical | `critical.slice` | 200 | 200 | 512M |
| elevated | `elevated.slice` | 150 | 150 | none |
| background | `background.slice` | 20 | 20 | none |

A Linux server MUST run the services in the following table in the resource class given for each.

| service | class | other settings |
|---|---|---|
| PostgreSQL | critical | out-of-memory policy `continue`, restart on failure after 30 seconds |
| Caddy | critical | OOM score adjustment -500 |
| the Tamanu API instances | critical | OOM score adjustment -500 |
| the Tamanu sync service of a facility server | elevated | none |
| the Tamanu FHIR workers of a central server | elevated | none |
| package refreshes, btrfs balance and scrub, and image pruning | background | none |

A Linux server MUST enable systemd accounting of CPU, I/O, IP, memory and tasks by default for all units.

A Linux server SHOULD use the bfq I/O scheduler on every disk.

> [!NOTE]
> I/O weights only take effect under a scheduler that honours cgroup I/O weight, and the default schedulers do not.

## Kernel hardening

A Linux server MUST prevent the kernel modules in the following table from loading, and MUST unload any that are loaded.

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

Where the Munin node is installed, a Linux server SHOULD enable the Munin plugins of its database, of Caddy and of its [alert daemon](../overview.md#alert-daemon).

## Endpoint security agent

A Linux server MAY run the Elastic Agent, enrolled in a Fleet at a configurable URL with an enrolment token that is a secret variable.

A Linux server on which the agent is disabled, or has no enrolment token, MUST have the agent stopped and removed with its data directory `/opt/Elastic`.

## Provisioning

A deployment's servers MUST be provisioned from one infrastructure stack for the deployment.

A server MUST be either an instance in the deployment's AWS account or an [external server](../overview.md#external-server).

An instance MUST boot from an Ubuntu 24.04 arm64 image with a btrfs root.

The infrastructure stack MUST refuse to run against an AWS account other than the account of its core.

An instance MUST have the properties in the following table.

| property | value |
|---|---|
| instance type | `t4g.medium`, unless the server configures another |
| root volume | gp3, encrypted, 50 GiB unless the server or the deployment configures another size |
| public address | one static Elastic IP address |
| metadata | IMDSv2 required, IPv6 endpoint enabled, instance metadata tags enabled |
| monitoring | detailed |
| termination protection | on, unless the deployment sets hard delete |
| subnet | a public workload subnet of the core, chosen by the position of the server among the deployment's servers |
| security group | the deployment's security group |

Changes to the size of the root volume after creation MUST NOT replace the instance.

An instance MUST run the following steps from its user data at first boot, in order.

1. Set the hostname to the server's fully qualified domain name.
1. Install Tailscale.
1. Join the tailnet with a single-use, pre-authorised key that expires after 6 hours, advertising the Tailscale tags of the deployment, under the Tailscale name of the server, with Tailscale SSH enabled and the user `ubuntu` as the operator.
1. Enable `tailscaled`.
1. Add the emergency public key.

The user data of an instance MUST be held as a secret.

> [!NOTE]
> The user data contains the Tailscale key.

A server in the split layout MUST have the additional volumes in the following table.

| volume | device | size | type |
|---|---|---|---|
| logs | `/dev/sdl` | 10 GiB | gp3, encrypted |
| data | `/dev/sdp` | 50 GiB | gp3, encrypted |

A volume of the split layout MUST be snapshotted when it is deleted.

Changes to the size of a volume of the split layout after creation MUST NOT replace the volume.

The Tailscale tags of a deployment's servers SHOULD default to `tag:server`, `tag:server-tamanu`, `tag:server-tamanu-<root>` where the zone has a root name, and `tag:server-tamanu-<type>` where the stack is recognisable as a `demo`, `clone` or `prod` deployment.

## Instance tags

An instance MUST carry the [instance tags](../overview.md#instance-tags) in the following table.

| tag | value | condition |
|---|---|---|
| `Name` | the name prefix followed by the server's display name | always |
| `FQDN` | the server's fully qualified domain name | always |
| `Partitioning` | `split-data-logs` or `single-btrfs` | always |
| `TailscaleName` | the server's Tailscale name | always |
| `TamanuServerID` | `central`, or the facility identifier | always |
| `TamanuServerName` | the server's display name | always |
| `TamanuServerType` | `central` or `facility` | always |
| `Purpose` | `tamanu-server` | always |
| `ManagedBy` | `pulumi` | always |
| `PatientPortalFQDN` | the patient portal hostname | the server is central and a patient portal label is configured |
| `MsupplyFQDN` | the mSupply hostname | the server has mSupply configured |
| `MsupplyTailscaleService` | the mSupply Tailscale service name | the server has mSupply configured |
| `TamanuCloneOf` | the reference of the source stack | the stack is a clone of another stack |

An instance MUST also carry the billing tags of the deployment.

The playbooks MUST read the instance tags `Partitioning`, `PatientPortalFQDN`, `MsupplyFQDN` and `MsupplyTailscaleService` from the instance metadata service with IMDSv2, and MUST treat an absent tag as unset.

A server that is not an instance MUST take the values of those tags from inventory variables.

## Naming

The hostnames and Tailscale names of a deployment MUST follow the forms in the following table.

| name | form |
|---|---|
| central hostname | `<subdomain>.<domain base>`, with the subdomain defaulting to `central` |
| facility hostname | `<subdomain>.<domain base>`, with the subdomain defaulting to the facility identifier |
| facility identifier | the configured identifier, prefixed with `facility-` where it does not begin with that |
| patient portal hostname | `<label>.<domain base>`, with the label defaulting to `patient` |
| mSupply hostname | `msupply.<subdomain>.<domain base>`, or `<prefix>.<domain base>` where a prefix is configured |
| Tailscale name of central | `<Tailscale base>-central` |
| Tailscale name of a facility | `<Tailscale base>-facility-<identifier without the prefix>` |
| mSupply Tailscale service | `svc:<Tailscale name>-svc-msupply` |

A domain base without a dot MUST be a subdomain of the zone of the core.

The patient portal hostname MUST be omitted where its label is configured empty.

A server's Tailscale name SHOULD be configurable.

## Network exposure

The security group of a deployment MUST allow the inbound traffic in the following table from any source.

| protocol | port |
|---|---|
| ICMP | all types and codes |
| ICMPv6 | all types and codes |
| TCP | 80 |
| TCP | 443 |
| UDP | 443 |

The security group MUST allow all outbound traffic.

## DNS records

A deployment MUST publish the DNS records in the following table, each with a time to live of 300 seconds.

| name | type | value | condition |
|---|---|---|---|
| server hostname | A | the Elastic IP address of an instance, or the IPv4 addresses of an external server | always |
| server hostname | AAAA | the first IPv6 address of an instance, or the IPv6 addresses of an external server | the server has an IPv6 address |
| patient portal hostname | CNAME | the central hostname | the patient portal hostname is set |
| mSupply hostname | CNAME | the hostname of its server | the server has mSupply configured |

A server MUST be an external server where its configuration says so or lists any external IP address.

An [external server](../overview.md#external-server) MUST NOT have an instance or volumes provisioned for it.

## Retired deployments

A retired deployment MUST have no instances, security group, instance backup plan, repository bucket or ACME users.

Where a retired deployment names a replacement domain base, every hostname it served MUST answer with a permanent redirect with status 301 to the same path and query under the replacement.

A hostname's label under the replacement domain base MUST be the label it had, unless a remapping for that label is configured.

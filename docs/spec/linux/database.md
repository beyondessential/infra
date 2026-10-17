---
id: LNXDB
---

# Database on a Linux server

The requirements in this spec apply to the PostgreSQL server of every [Linux server](../overview.md#linux-server).
Backups of the database are specified by [LNXBAK](backups.md) and [PPB](../postgres-physical-backup.md).
The tuning of a PostgreSQL cluster in Kubernetes is specified by [K8SPGC](../kubernetes/postgres.md).

## Borrowed terms

| term | meaning |
|---|---|
| cluster | A PostgreSQL cluster, one data directory served by one server process ([PostgreSQL database clusters](https://www.postgresql.org/docs/current/creating-cluster.html)). |
| `pg_hba.conf` | The file that selects the authentication method for each connection type, database, role and address ([The pg_hba.conf file](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html)). |
| `peer` | Authentication of a local connection by the operating system user of the client ([Peer authentication](https://www.postgresql.org/docs/current/auth-peer.html)). |
| user name map | A `pg_ident.conf` entry that maps an operating system user to a database role ([User name maps](https://www.postgresql.org/docs/current/auth-username-maps.html)). |
| `scram-sha-256` | Password authentication by salted challenge-response ([Password authentication](https://www.postgresql.org/docs/current/auth-password.html)). |
| `ALTER SYSTEM` | The command that stores a server parameter in `postgresql.auto.conf` ([ALTER SYSTEM](https://www.postgresql.org/docs/current/sql-altersystem.html)). |
| `pg_upgrade` | The tool that upgrades a cluster to a new major version, by copying, linking or cloning files ([pg_upgrade](https://www.postgresql.org/docs/current/pgupgrade.html)). |
| data checksums | Page checksums that a cluster is initialised with or converted to ([pg_checksums](https://www.postgresql.org/docs/current/app-pgchecksums.html)). |
| server parameters | The configuration parameters of PostgreSQL ([PostgreSQL server configuration](https://www.postgresql.org/docs/current/runtime-config.html)). |
| BES Linux image | The disk image that BES's linux-images repository builds ([disk images](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#variants)). |
| btrfs quota group | The accounting unit that btrfs uses to limit the space a subvolume references ([btrfs quota groups](https://btrfs.readthedocs.io/en/latest/Qgroups.html)). |

## Version and layout

A Linux server MUST run one PostgreSQL cluster named `main`.

The cluster MUST run PostgreSQL from the PostgreSQL project's package repository, at the major version that the inventory variable `postgresql_version` names, which is 18 unless the inventory sets another.

The version of a cluster that is already installed MUST take precedence over `postgresql_version` unless major version upgrades are enabled.

The path `/etc/postgresql/current` MUST be a symbolic link to the configuration directory of the running major version.

The path `/var/lib/postgresql/current` MUST be a symbolic link to the data directory `/var/lib/postgresql/<major version>/main` of the running major version.

The packages `postgresql-<major version>` and `postgresql-client-<major version>` MUST be held against unattended upgrade.

The cluster listed as online under the name `main` MUST be exactly one, and its data directory MUST be the directory that `/var/lib/postgresql/current` resolves to.

> [!NOTE]
> The backup resolves the cluster by the name `main`, so a second online cluster or a data directory elsewhere makes the backup capture the wrong files.

The directory `/var/run/postgresql` MUST exist at boot with mode 2775, owned by `postgres:postgres`.

A system-wide `psqlrc` SHOULD define the shortcut `lsf` as a query of `local_system_facts` that returns its `key` and `value`.

## Data directory

On a server in the single layout, `/var/lib/postgresql` SHOULD be the btrfs subvolume `@postgres` of the root filesystem, as [`image.btrfs.subvolumes`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#btrfs-configuration) requires of an image.

Where the root filesystem is btrfs with the subvolume `@` and `/var/lib/postgresql` is not a mount point, provisioning MUST create the subvolume `@postgres` and mount it at `/var/lib/postgresql` through an `/etc/fstab` entry.

Where `/var/lib/postgresql` already holds data when the subvolume is created, the data MUST be copied into the subvolume with ownership, ACLs, extended attributes and hard links preserved, with the cluster stopped.

On a btrfs filesystem, the compression level of every `/etc/fstab` entry for the filesystem that holds `/var/lib/postgresql` MUST be `zstd:1`, as [`image.btrfs.compression`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#btrfs-configuration) requires of an image, and the live mount MUST be remounted at that level.

> [!NOTE]
> btrfs applies the mount options of the first mount to the whole filesystem, so entries that disagree make the effective level unpredictable.

On a btrfs filesystem the cluster SHOULD set `wal_init_zero` and `wal_recycle` to `off`.

Where the inventory variable `postgresql_btrfs_quota_percent` is set and the filesystem is btrfs with quotas enabled, the referenced-space limit of the `@postgres` subvolume MUST be that percentage of the size of the filesystem.

## Access

The cluster MUST listen on `localhost`, and additionally on the IPv4 and IPv6 Tailscale addresses of the server where the server is a member of the tailnet.

The cluster MUST accept connections as the `pg_hba.conf` entries in the following table require.

| type | databases | roles | source | method |
|---|---|---|---|---|
| local | all | `postgres` | not applicable | `peer` |
| local | replication | all | not applicable | `peer` |
| local | all | `alertd`, with the user name map `alertd` | not applicable | `peer` |
| local | the Tamanu database | the owner of the Tamanu database | not applicable | `scram-sha-256` |
| local | `tamanu` | `tamanu_reporting` and `tamanu_raw`, on a Tamanu server at version 2.60.0 or later | not applicable | `scram-sha-256` |
| local | `tamanu` | `reporting` and `raw`, on a Tamanu server at a version lower than 2.60.0 | not applicable | `scram-sha-256` |
| host | all | all | `100.64.0.0/10` and `fd7a:115c:a1e0::/56` | `scram-sha-256` |

The cluster MUST have the values in the following table for the parameters that protect its connections.

| parameter | value |
|---|---|
| `ssl_ciphers` | `HIGH:!SSLv3:!TLSv1` |
| `scram_iterations` | `50000` |

`listen_addresses` and `ssl_ciphers` MUST be set in `postgresql.conf`, and every other parameter that this spec sets MUST be set with `ALTER SYSTEM`.

> [!NOTE]
> A parameter set with `ALTER SYSTEM` is stored in the data directory and is carried by a backup of it, while a parameter in `postgresql.conf` belongs to the machine.

## Roles and credentials

The [credential seed](../overview.md#credential-seed) is the secret value from which, with the machine identifier, the database passwords of a server derive.

A Tamanu server MUST have a database named `tamanu`, owned by a role of the same name.

A Tamanu server MUST connect to its database over the Unix socket directory `/var/run/postgresql`.

The role that owns the Tamanu database MUST have the `CREATEROLE` attribute.

The roles `reporting` and `raw` MUST exist on a Tamanu server at a version lower than 2.60.0, each with a derived password.

A Tamanu server at version 2.60.0 or later MUST leave the roles `tamanu_reporting` and `tamanu_raw` to Tamanu, which creates and manages them, as [K8STDR](../kubernetes/tamanu/deployment-rollout.md#version-gated-steps) gives for the same release.

The credential seed of a deployment MUST be a secret variable and MUST NOT be a host tag.

The password of a role MUST be a function of the machine identifier of the server, the credential seed, and the name of the role, so that provisioning the server again yields the same password.

A password MUST be a string of ASCII letters and digits.

> [!NOTE]
> Rebuilding the machine, or changing the credential seed, changes every password that is derived from it.

The role `alertd` MUST exist on every server that runs PostgreSQL, with the attributes `LOGIN`, `NOSUPERUSER`, `NOCREATEDB` and `NOCREATEROLE`, no password, and membership of `pg_read_all_data` and `pg_monitor`.

The user name map `alertd` MUST map the operating system user `root` to the role `alertd`.

Where the Munin node is installed, its PostgreSQL plugins MUST connect over the socket as the role `alertd` to the database `postgres`.

## Tuning

A Linux server SHOULD tune its cluster as this section requires, unless the inventory variable `postgresql_tune_enabled` is false.

The cluster MUST have the values of bestool's [tuning values](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/pg-tune.md#tuning-values), computed from the [resource budget](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/pg-tune.md#resource-budget) of the server with its memory budget set to its cache budget.

The cluster MUST also have the values in the following table, which bestool's tuning values do not give.

| parameter | value |
|---|---|
| `max_connections` | 100, or the value of `postgresql_tune_max_connections` |
| `effective_io_concurrency` | `200` |
| `io_method` | `io_uring`, from major version 18 |
| `archive_timeout` | `300` |
| `archive_mode` | the PostgreSQL default |
| `archive_command` | the PostgreSQL default |
| `temp_file_limit` | the value of `postgresql_tune_temp_file_limit` where set, otherwise `postgresql_tune_temp_file_limit_percent` percent of the temporary-file basis, which is 25 percent unless the inventory sets another |

The temporary-file basis MUST be the lower of the size of the filesystem that holds `/var/lib/postgresql` and the referenced-space limit of the `@postgres` subvolume where that limit is set, and the size of the filesystem otherwise.

Provisioning MUST treat a server as a [production server](../overview.md#production-server) where its Tailscale name contains the text `prod`.

A restart that a parameter change requires MAY be performed by provisioning on a server that is not a production server.

Provisioning MUST NOT restart PostgreSQL on a production server, and MUST report that a restart is pending.

A parameter change that takes effect without a restart MUST be applied by a reload.

## Major version upgrades

Major version upgrades MUST be enabled only where the inventory variable `postgresql_upgrade_enabled` is true.

An upgrade MUST be refused where the installed major version is higher than the desired version.

An upgrade MUST be performed only where `/var/lib/postgresql` is on a btrfs filesystem.

Before an upgrade changes the cluster, it MUST create a read-only btrfs snapshot of the subvolume that holds `/var/lib/postgresql`, at the top level of the filesystem, named `<subvolume>-pre-pgupgrade-<old major version>-to-<new major version>-<timestamp>`.

An upgrade MUST convert a cluster that has no data checksums to data checksums before it upgrades the cluster.

An upgrade MUST run the compatibility check of `pg_upgrade` before it upgrades the cluster, and MUST stop if the check fails.

An upgrade MUST carry the configuration of the old version over to the new version.

After an upgrade the symbolic links `/etc/postgresql/current` and `/var/lib/postgresql/current` MUST name the new version, and the statistics of all databases MUST be rebuilt.

The data of the old cluster MUST be removed only where the inventory variable `postgresql_cleanup_old_cluster` is true.

A read-only check of whether an upgrade is needed and permitted MUST report one of the values in the following table.

| value | meaning |
|---|---|
| `NO_POSTGRES` | No data directory link exists. |
| `NO_UPGRADE_NEEDED` | The installed version is the desired version. |
| `WILL_UPGRADE` | An upgrade is needed and the filesystem permits it. |
| `UPGRADE_BLOCKED` | An upgrade is needed and the filesystem does not permit it. |
| `UNKNOWN` | None of the above applies. |

## Inventory variables

The variables in the following table configure the database of a Linux server.

| variable | default | meaning |
|---|---|---|
| `postgresql_version` | `18` | The major version of the cluster. |
| `postgresql_tune_enabled` | `true` | Whether the cluster is tuned as [Tuning](#tuning) requires. |
| `postgresql_tune_max_connections` | `100` | The value of `max_connections`. |
| `postgresql_tune_temp_file_limit` | none | A value of `temp_file_limit` that replaces the derived limit. |
| `postgresql_tune_temp_file_limit_percent` | `25` | The percentage of the temporary-file basis that the derived `temp_file_limit` is. |
| `postgresql_btrfs_quota_percent` | none | The percentage of the filesystem at which the `@postgres` subvolume is capped. |
| `postgresql_upgrade_enabled` | `false` | Whether [major version upgrades](#major-version-upgrades) are enabled. |
| `postgresql_cleanup_old_cluster` | `false` | Whether the data of the old cluster is removed after an upgrade. |

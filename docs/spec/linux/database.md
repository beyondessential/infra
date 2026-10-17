---
id: LNXDB
---

# Database on a Linux server

The requirements in this spec apply to the PostgreSQL server of every [Linux server](../overview.md#linux-server).
Backups of the database are specified by [LNXBAK](backups.md) and [PPB](../postgres-physical-backup.md).
The memory parameters follow the algorithm of [K8SPGC](../kubernetes/postgres.md#memory-parameters) with the basis and floors that [Tuning](#tuning) gives.

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
| btrfs quota group | The accounting unit that btrfs uses to limit the space a subvolume references ([btrfs quota groups](https://btrfs.readthedocs.io/en/latest/Qgroups.html)). |

## Version and layout

A Linux server MUST run one PostgreSQL cluster named `main`.

The cluster MUST run PostgreSQL from the PostgreSQL project's package repository, at the major version that the inventory variable `postgresql_version` names, which is 18 unless the inventory sets another.

The version of a cluster that is already installed MUST take precedence over `postgresql_version` unless major version upgrades are enabled.

The path `/etc/postgresql/current` MUST be a symbolic link to the configuration directory of the running major version.

The path `/var/lib/postgresql/current` MUST be a symbolic link to the data directory `/var/lib/postgresql/<major version>/main` of the running major version.

The packages `postgresql-<major version>` and `postgresql-client-<major version>` MUST be held against unattended upgrade.

The cluster listed as online under the name `main` MUST be exactly one, and its data directory MUST be the directory that `/var/lib/postgresql/current/main` resolves to.

> [!NOTE]
> The backup resolves the cluster by the name `main`, so a second online cluster or a data directory elsewhere makes the backup capture the wrong files.

The directory `/var/run/postgresql` MUST exist at boot with mode 2775, owned by `postgres:postgres`.

A system-wide `psqlrc` SHOULD define the shortcut `lsf` as a query of `local_system_facts` that returns its `key` and `value`.

## Data directory

On a server in the single layout, `/var/lib/postgresql` MUST be the btrfs subvolume `@postgres` of the root filesystem, mounted through an `/etc/fstab` entry with the options `compress=zstd:1,subvol=@postgres`.

Where `/var/lib/postgresql` already holds data when the subvolume is created, the data MUST be copied into the subvolume with ownership, ACLs, extended attributes and hard links preserved, with the cluster stopped.

On a btrfs filesystem, the compression level of every `/etc/fstab` entry for the filesystem that holds `/var/lib/postgresql` MUST be `zstd:1`, and the live mount MUST be remounted at that level.

On a btrfs filesystem the cluster MUST set `wal_init_zero` and `wal_recycle` to `off`.

> [!NOTE]
> btrfs applies the mount options of the first mount to the whole filesystem, so entries that disagree make the effective level unpredictable.

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
| local | `tamanu` | `reporting`, `raw`, `tamanu_reporting` and `tamanu_raw` | not applicable | `scram-sha-256` |
| host | all | all | `100.64.0.0/10` and `fd7a:115c:a1e0::/56` | `scram-sha-256` |

The cluster MUST restrict `ssl_ciphers` to `HIGH:!SSLv3:!TLSv1`.

The cluster MUST set `scram_iterations` to 50000.

`listen_addresses` and `ssl_ciphers` MUST be set in `postgresql.conf`, and every parameter that [Tuning](#tuning) names MUST be set with `ALTER SYSTEM`.

> [!NOTE]
> A parameter set with `ALTER SYSTEM` is stored in the data directory and is carried by a backup of it, while a parameter in `postgresql.conf` belongs to the machine.

## Roles and credentials

A Tamanu server MUST have a database named `tamanu`, owned by a role of the same name.

A Tamanu server MUST connect to its database over the Unix socket directory `/var/run/postgresql`.

The role that owns the Tamanu database MUST have the `CREATEROLE` attribute.

The roles `reporting` and `raw` MUST exist on a Tamanu server, each with a derived password.

The [credential seed](../overview.md#credential-seed) of a deployment MUST be a secret variable and MUST NOT be a host tag.

The password of a role MUST be a function of the machine identifier of the server, the credential seed, and the name of the role, so that provisioning the server again yields the same password.

A password MUST be a string of ASCII letters and digits.

> [!NOTE]
> Rebuilding the machine, or changing the credential seed, changes every password that is derived from it.

The role `alertd` MUST exist on every server that runs PostgreSQL, with the attributes `LOGIN`, `NOSUPERUSER`, `NOCREATEDB` and `NOCREATEROLE`, no password, and membership of `pg_read_all_data` and `pg_monitor`.

The user name map `alertd` MUST map the operating system user `root` to the role `alertd`.

Where the Munin node is installed, its PostgreSQL plugins MUST connect over the socket as the role `alertd` to the database `postgres`.

## Tuning

A Linux server SHOULD tune its cluster as this section requires, unless the inventory variable `postgresql_tune_enabled` is false.

The tuning MUST derive from an effective memory and an effective CPU count, which are computed from the host's memory and CPU count by the rules in the following table.

| quantity | rule |
|---|---|
| effective memory | the host memory less 4 GiB where the host has 8 GiB or more, otherwise half the host memory |
| effective CPU count | the host CPU count where it is 1, 2 where it is 2 to 4, 4 where it is 5 to 7, and the host CPU count less 4 where it is 8 or more |

A cluster MUST set each parameter in the following table to the value given for it.

| parameter | value |
|---|---|
| `max_connections` | 100, or the value of `postgresql_tune_max_connections` |
| `shared_buffers` | a quarter of the effective memory |
| `effective_cache_size` | three quarters of the effective memory |
| `maintenance_work_mem` | a sixteenth of the effective memory, at most 8 GiB |
| `work_mem` | the effective memory less `shared_buffers`, divided by three times the sum of `max_connections` and the worker budget, and at least 4 MiB |
| `wal_buffers` | three percent of `shared_buffers`, at least 32 kiB and at most 16 MiB, and 16 MiB where the computed value is more than 14 MiB |
| `checkpoint_completion_target` | `0.9` |
| `default_statistics_target` | `100` |
| `random_page_cost` | `1.1` |
| `effective_io_concurrency` | `200` |
| `huge_pages` | `try` where `shared_buffers` is 2 GiB or more, otherwise `off` |
| `min_wal_size` | `2GB` |
| `max_wal_size` | `8GB` |
| `archive_timeout` | `300` |
| `archive_mode` | reset to the PostgreSQL default |
| `archive_command` | reset to the PostgreSQL default |
| `temp_file_limit` | the value of `postgresql_tune_temp_file_limit` where set, otherwise `postgresql_tune_temp_file_limit_percent` percent of the temporary-file basis, which is 25 percent unless the inventory sets another |
| `autovacuum_work_mem` | 2 GiB where `maintenance_work_mem` is 2 GiB or more, otherwise unset |
| `autovacuum_max_workers` | 5 where the effective CPU count is 32 or more, 4 where it is 16 or more, otherwise unset |

The worker budget MUST be the effective CPU count where the effective CPU count is 4 or more, and 8 otherwise.

The temporary-file basis MUST be the lower of the size of the filesystem that holds `/var/lib/postgresql` and the referenced-space limit of the `@postgres` subvolume where that limit is set, and the size of the filesystem otherwise.

A cluster whose effective CPU count is 4 or more MUST set the parameters in the following table.

| parameter | value |
|---|---|
| `max_worker_processes` | the effective CPU count |
| `max_parallel_workers` | the effective CPU count |
| `max_parallel_workers_per_gather` | half the effective CPU count rounded up, at most 4 |
| `max_parallel_maintenance_workers` | half the effective CPU count rounded up, at most 4 |

A cluster MUST set the parameters in the following table where its major version is at least the version given.

| parameter | value | from major version |
|---|---|---|
| `jit` | `off` | 12 |
| `wal_compression` | `on` | 10 |
| `wal_compression` | `lz4` | 15 |
| `io_method` | `io_uring` | 18 |
| `io_workers` | the effective CPU count divided by 4, at most 32, set only where the result is more than 3 | 18 |

> [!NOTE]
> The table is read in order, so the later row of `wal_compression` replaces the earlier one.

A change to `max_connections`, `shared_buffers`, `wal_buffers`, `huge_pages`, `max_worker_processes`, `io_method`, `autovacuum_max_workers` or `listen_addresses` takes effect only at a restart.

Provisioning MUST treat a server as a [production server](../overview.md#production-server) where its Tailscale name contains the text `prod`.

A restart that such a change requires MAY be performed by provisioning on a server that is not a production server.

Provisioning MUST NOT restart PostgreSQL on a production server, and MUST report that a restart is pending.

A change to any other parameter of the cluster that provisioning makes MUST be applied by a reload.

## Major version upgrades

Major version upgrades MUST be enabled only where the inventory variable `postgresql_upgrade_enabled` is true.

An upgrade MUST be refused where the installed major version is higher than the desired version.

An upgrade MUST be performed only where `/var/lib/postgresql` is on a btrfs filesystem.

Before an upgrade changes the cluster, it MUST create a read-only btrfs snapshot of the subvolume that holds `/var/lib/postgresql`, at the top level of the filesystem, named `<subvolume>-pre-pgupgrade-<old major version>-to-<new major version>-<timestamp>`.

An upgrade MUST convert a cluster that has no data checksums to data checksums before upgrading it.

An upgrade MUST run a compatibility check with `--check` and MUST stop if it fails.

An upgrade SHOULD use file cloning, and MUST fall back to copying where cloning fails.

An upgrade MUST copy the configuration of the old version into the configuration directory of the new version, and MUST set `data_directory`, `cluster_name`, `external_pid_file`, `hba_file` and `ident_file` in it to the paths of the new version.

After an upgrade the symbolic links `/etc/postgresql/current` and `/var/lib/postgresql/current` MUST name the new version, and the statistics of all databases MUST be rebuilt in stages.

The data of the old cluster MUST be removed only where the inventory variable `postgresql_cleanup_old_cluster` is true.

After an upgrade the packages of the old version MUST be removed and the packages of the new version MUST be held against unattended upgrade.

A read-only check of whether an upgrade is needed and permitted MUST report one of the values in the following table.

| value | meaning |
|---|---|
| `NO_POSTGRES` | No data directory link exists. |
| `NO_UPGRADE_NEEDED` | The installed version is the desired version. |
| `WILL_UPGRADE` | An upgrade is needed and the filesystem permits it. |
| `UPGRADE_BLOCKED` | An upgrade is needed and the filesystem does not permit it. |
| `UNKNOWN` | None of the above applies. |

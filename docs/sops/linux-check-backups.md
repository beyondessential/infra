# SOP: Check that a Linux server's backups are working

Read-only. **[diagnose]**
A restore refuses until a key backup exists, so a missing one matters before any restore ([key pairing](../spec/linux/backups.md#key-pairing)).
Backups themselves are scheduled and retained by Canopy; this checks that the host does its part and that the infrastructure is in place.

## On the host

1. The definitions are present: `ls -l /etc/bestool/backups`. Expect `tamanu-postgres.toml`, `postgres-config.toml`, `tamanu-config.toml`, `caddy-config.toml`, and `tamanu-secrets.toml` everywhere except a clone ([definitions](../spec/linux/backups.md#backup-definitions)).
2. The daemon runs: `systemctl status bestool-alertd` and `journalctl -u bestool-alertd --since "1 day ago"`. It registers each definition with Canopy and runs the backups. **[diagnose, sensitive-data]**
3. PostgreSQL is resolvable by name for the backup: `pg_lsclusters` shows exactly one online `main` ([LNXDB](../spec/linux/database.md#version-and-layout)).
4. Storage for the snapshot: the data must be on btrfs for a snapshot backup, otherwise the backup falls back to `pg_basebackup` and needs free space about the size of the cluster ([bestool BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-postgresql-method)). `findmnt /var/lib/postgresql`, `df -h`.
5. Leaked snapshots: a hard reboot mid-backup can leave snapshot subvolumes behind, and the next run removes them first ([bestool BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-postgresql-method)). `sudo btrfs subvolume list /` shows them.

## In Canopy

Use the backup signals and checks: *backed up*, *persisted*, *restorable* ([PPB](../spec/postgres-physical-backup.md#canopy-integration)).
The Tamanu pack's [healthchecks bridge](https://github.com/beyondessential/tamanu/blob/main/docs/healthchecks.md) says to call Canopy's `get_check_documentation` for the failing check first.

## In AWS

A human with a read-only profile runs these. **[diagnose]**

- Instance snapshots, per account: `aws backup list-backup-jobs --by-backup-vault-name tamanu-on-linux-<stack>`. Failed, aborted and expired jobs are forwarded to a central event bus ([LNXBAK](../spec/linux/backups.md#backup-failure-notification)).
- The repository bucket and roles exist: the stack outputs `backupBucket`, `deviceRoleArn`, `maintenanceRoleArn` ([stack reference](../reference/linux-pulumi-config.md#outputs)).

External servers are not covered by instance snapshots, so their only backup is the Canopy-driven repository.
A failing check goes to [backup failing](../runbooks/linux-backup-failing.md).

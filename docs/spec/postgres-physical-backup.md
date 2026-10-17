---
id: PPB
---

# PostgreSQL physical backup

A physical backup is a restorable file-level image of a PostgreSQL cluster's data directory, stored in a Kopia repository.
The backup MUST run on Windows and on Linux.

> [!NOTE]
> The evidence behind these requirements is in [the restore failure analysis](../reference/postgres-physical-backup-diagnosis.md).

## Borrowed terms

| term | meaning |
|---|---|
| crash recovery | PostgreSQL's replay of the WAL on startup after an unclean shutdown ([PostgreSQL file system level backup](https://www.postgresql.org/docs/current/backup-file.html)). |
| `backup_label` | The file `pg_backup_stop` returns, which makes a restore recover to the end of the backup ([PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)). |
| `pg_basebackup` | The PostgreSQL tool that takes a base backup of a running cluster ([pg_basebackup](https://www.postgresql.org/docs/current/app-pgbasebackup.html)). |
| tablespace | A directory outside the data directory that holds cluster files, linked from `pg_tblspc` ([PostgreSQL file system level backup](https://www.postgresql.org/docs/current/backup-file.html)). |
| Kopia | The snapshot repository the backup is stored in ([Kopia documentation](https://kopia.io/docs/)). |
| VSS | The Windows Volume Shadow Copy Service, which takes shadow copies of volumes, singly or as a set ([Volume Shadow Copy Service](https://learn.microsoft.com/en-us/windows-server/storage/file-server/volume-shadow-copy-service)). |
| thin LV | An LVM logical volume whose segment type is `thin` ([lvmthin](https://man7.org/linux/man-pages/man7/lvmthin.7.html)). |

## Strategy

A backup MUST use the strategy that the following table gives for its platform and storage.

| platform | storage | strategy |
|---|---|---|
| Windows | any | [snapshot strategy](overview.md#snapshot-strategy) over a VSS shadow-copy set |
| Linux | btrfs | snapshot strategy over subvolume snapshots |
| Linux | thin LV | snapshot strategy over a thin snapshot |
| Linux | thick LV | [base backup strategy](overview.md#base-backup-strategy) |
| Linux | no volume manager | base backup strategy |

A volume MUST be treated as a thin LV only if its LVM segment type is `thin`.

Where the storage cannot be identified, the backup MUST use the base backup strategy.

The strategy MAY be overridden by configuration.

> [!NOTE]
> A thick LVM snapshot is atomic, but it copies on first write for its whole lifetime, which slows writes to the live database while the snapshot is read, and its fixed copy-on-write area invalidates the snapshot if it overflows.
> It is therefore treated as storage without a cheap atomic snapshot.

## Snapshot strategy

The backup SHOULD issue a `CHECKPOINT` immediately before it takes the snapshot.

A failed `CHECKPOINT` MUST NOT fail the backup.

> [!NOTE]
> The checkpoint bounds the WAL replayed on restore.
> The snapshot is crash-consistent without it.

The backup MUST NOT call `pg_backup_start` or `pg_backup_stop`, and MUST NOT write a `backup_label`.

> [!NOTE]
> A restore driven by `backup_label` must recover to the end of the backup.
> The backup-end WAL record is written after the snapshot instant, into the live `pg_wal`, so the frozen copy lacks it and recovery fails with `WAL ends before end of online backup`.

The backup MUST take a single atomic snapshot that covers every volume the cluster occupies.

On Windows the snapshot MUST be one VSS shadow-copy set.

Where a cluster occupies more than one volume on a backend that cannot snapshot them simultaneously, the backup MUST use the base backup strategy.

> [!NOTE]
> Thin LVM cannot snapshot several logical volumes in one operation, and btrfs snapshots of several subvolumes are not one atomic act.
> Snapshots taken one after another capture files at different instants, which is the corruption PostgreSQL warns about.

The snapshot MUST include `pg_wal`.

The backup MUST NOT exclude `pg_wal`, whether by omitting it from the snapshot or by ignoring it in Kopia.

The backup MUST expose the snapshot read-only and MUST read the data directory from within the frozen snapshot.

The backup MUST NOT read the live data directory.

## Base backup strategy

The backup MUST run `pg_basebackup` with `--wal-method=stream` into a staging directory, and then store the staging directory in Kopia.

> [!NOTE]
> A file-level copy of a live directory is torn, and needs the WAL that spans the copy to become consistent.
> Streaming bundles that WAL and the backup-end record into the base backup, so the backup restores by crash recovery.
> Staging needs free space of about the size of the cluster.

The backup MUST delete the staging directory when the run ends.

## Common behaviour

The backup MUST identify the data directory of the cluster and every volume the cluster occupies: the data directory, `pg_wal` including where it is a symlink or junction to another volume, and every tablespace under `pg_tblspc`.

For a snapshot of a cluster with tablespaces, the backup MUST record the mapping from each tablespace OID to its snapshot volume, so that a restore can relink the tablespace.

Kopia MUST see the same source path on every run.

> [!NOTE]
> A different path per run makes every backup a new source with no snapshot history, no incremental deduplication and no retention.

The backup MUST ignore nothing other than `postmaster.pid`, `*.log`, `pg_stat_tmp/*` and `lost+found`.

The backup MUST NOT ignore `pg_wal`, `pg_xact`, `pg_control`, `global` or any tablespace.

The backup MUST tag the Kopia snapshot with `pg-version`, `pg-cluster` and `pg-strategy`, holding the PostgreSQL version, the cluster name and the strategy used.

## Restore

A backup MUST restore by crash recovery alone: the snapshot or base backup is laid down as the data directory, PostgreSQL is started, and it replays `pg_wal`.

A restore MUST NOT need `recovery.signal`, `restore_command` or a `backup_label`.

A restore MUST NOT need `pg_resetwal` or a forced reindex of every database.

Every backup MUST be self-contained: restorable on its own, with all the WAL it needs included.

## Canopy integration

The backup is the producer for [Canopy](overview.md#canopy) of the backup signals *backed up* and *persisted*.
[pgro](overview.md#pgro) reports the signal *restorable*.

The backup MUST tag its Kopia snapshots with the Canopy backup type `tamanu-postgres`.

> [!NOTE]
> pgro finds its snapshots by filtering the repository on that type.

The backup MUST attribute its snapshots using Canopy's source model: a Kopia source identity of the form `canopy@<server-id>:<path>`, and the `canopy-run` tag.

The backup MUST obtain its Kopia repository connection from Canopy through the device credential-process flow, and MUST NOT use long-lived static keys.

> [!NOTE]
> The connection is the short-lived per-group S3 credentials, the target and the repository password.

The backup MUST report its outcome to Canopy when it completes.

## Reliability

If an atomic snapshot cannot be obtained, for example because VSS fails, privileges are missing, or the layout cannot be captured together, the backup MUST NOT copy the live data directory.

In that case the backup MAY use the base backup strategy, and MUST report why the snapshot was not used.

A backup that cannot produce either an atomic snapshot or a base backup MUST exit with a non-zero status.

Before it creates a snapshot, the backup MUST remove the leftovers of a crashed earlier run: VSS shadow copies, btrfs snapshot subvolumes, LVM snapshots, and their exposed mounts and junctions.

> [!NOTE]
> A hard reboot mid-run skips cleanup, and leaked snapshots fill the volume.

When a run ends, whether it succeeded or failed, the backup MUST release its snapshot or shadow-copy set and remove its exposed mounts and junctions.

A backup MUST NOT start while another backup of the same type is running on the host.

A backup that lacks the privileges its strategy needs MUST say which privilege is missing.

> [!NOTE]
> VSS needs Administrator on Windows, and btrfs and LVM snapshots need root or `CAP_SYS_ADMIN` on Linux.

The backup MUST run on a schedule at a configurable interval.

The backup SHOULD run at low I/O and CPU priority.

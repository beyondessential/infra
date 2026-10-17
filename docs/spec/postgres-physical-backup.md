---
id: PPB
---

# PostgreSQL physical backup

A physical backup is a restorable file-level image of a PostgreSQL cluster's data directory, stored in a [Kopia](https://kopia.io/docs/) repository.
How bestool takes and restores the image is specified by [bestool BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-postgresql-method).

## Borrowed terms

| term | meaning |
|---|---|
| crash recovery | PostgreSQL's replay of the WAL on startup after an unclean shutdown ([PostgreSQL file system level backup](https://www.postgresql.org/docs/current/backup-file.html)). |
| `backup_label` | The file `pg_backup_stop` returns, which makes a restore recover to the end of the backup ([PostgreSQL continuous archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)). |

## Method

The backup MUST be taken by the `postgresql` method of bestool.

## Restore

A backup MUST restore by crash recovery alone: the image is laid down as the data directory, PostgreSQL is started, and it replays `pg_wal`.

A restore MUST NOT need `recovery.signal`, `restore_command` or a `backup_label`.

A restore MUST NOT need `pg_resetwal` or a forced reindex of every database.

Every backup MUST be self-contained: restorable on its own, with all the WAL it needs included.

## Canopy integration

The backup is the producer for [Canopy](overview.md#canopy) of the backup signals *backed up* and *persisted*.
[pgro](overview.md#pgro) reports the signal *restorable*.

The backup MUST be taken under the Canopy backup type `tamanu-postgres`.

> [!NOTE]
> pgro finds its snapshots by filtering the repository on that type.

How a device obtains its repository connection, tags its snapshots and reports a run is specified by bestool in [BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-control-plane-contract) and by Canopy in [BAK](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/backup.md).

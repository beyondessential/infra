# PostgreSQL physical backups: why restores were dirty

Analysis behind the requirements in [PPB](spec/postgres-physical-backup.md), written when backups were taken by the Ansible `kopia-backup-postgres-*` scripts on Linux and by pointing Kopia at the live directory on Windows.
It records the evidence for the requirements and is not itself a requirement.


Neither current method is bestool — Linux uses the Ansible scripts, Windows
points Kopia at the live directory directly. Both nonetheless end up
restoring through `pg_resetwal -f` + a forced full REINDEX, which is the
direct cause of "partially corrupted, mostly indexes" — but for two
different upstream reasons.

**Linux (Ansible scripts).** They take the btrfs snapshot *between*
`pg_backup_start` and `pg_backup_stop` and write the start-only `backup_label`
returned by `pg_backup_stop` **into** the snapshot. `pg_backup_stop` emits its
`XLOG_BACKUP_END` WAL record *after* the snapshot instant, into the live
`pg_wal`, so the frozen copy lacks it. PostgreSQL requires a
`backup_label`-driven restore to reach the backup-end point — "you cannot use
a base backup to recover to a time when that backup was in progress" — so
recovery fails with **`WAL ends before end of online backup`**. The btrfs
snapshot is itself atomic and would have restored cleanly as crash recovery;
the `backup_label` is precisely what breaks it.

**Windows (Kopia-direct, no bestool today).** No `pg_backup_start` and no
`backup_label` at all — Kopia is pointed at the live data directory with VSS
meant to supply the point-in-time copy. The failure here is a **non-atomic
capture**: if VSS does not actually engage (silent fallback to reading live
files), or `pg_wal`/tablespaces sit on a volume the shadow copy does not
include, Kopia reads files at inconsistent instants. The result is torn
WAL/pages, and recovery hits **`invalid record length`** /
**`could not locate required checkpoint record`**.

**Both land in the same place.** `pgro`'s restore Job
(`pgro/src/controllers/restore/builders.rs`) runs `postgres --single`, greps
for *all* of those signatures (`WAL ends before end of online backup|invalid
record length at|database system was interrupted while in recovery|could not
locate required checkpoint record`), and on any hit runs **`pg_resetwal -f`**,
which *bypasses WAL replay* and forces the cluster up at whatever the snapshot
captured. Skipping recovery leaves in-flight index updates as torn pages
("unexpected zero page at block N"), so the Job `touch`es `needs-reindex-all`
and **REINDEXes every database** before marking the replica ready. It "works
most of the time" only because `pg_resetwal` + REINDEX usually salvages the
cluster; when a torn page lands in the heap or catalog, or discarded WAL
mattered, it doesn't.

**The fix is producer-side and differs by platform.** Linux must stop writing
the `backup_label` (its snapshot is already atomic → clean crash recovery);
Windows must guarantee a genuinely atomic capture (a real VSS set over every
cluster volume) instead of reading the live directory. Both then restore as
clean crash recovery, and `pgro` never needs `pg_resetwal`.

## Field evidence (Windows restores)

Observed symptoms, in increasing severity, all consistent with a non-atomic
capture recovered via `pg_resetwal`:

- B-tree corruption on `logs.changes` (`changes_version_idx`); fixed by
  `REINDEX TABLE logs.changes`.
- B-tree corruption on `notes` (`notes_pkey1`): *"heap tid from index tuple
  points past end of heap page"*; fixed by `REINDEX TABLE notes`. The index
  references heap rows the heap file does not contain — the index was captured
  at a later instant than its heap (temporal skew between two files).
- A migration (`updateEncountersTableSetPatientIdNotNull`) failing with FK
  violation `encounters_patient_id_fkey1`: orphaned `encounters` rows whose
  `patient_id` is absent from `patients`.

The first two are index-vs-heap skew and `REINDEX`-recoverable. The third is
**heap-vs-heap skew** across two tables — impossible in a live cluster (the FK
forbids it), **not** fixable by `REINDEX` (no patient row exists to point at),
and therefore unrecoverable data corruption. It is the clearest proof that the
files in the backup are not from a single instant. Two corollaries:

1. Even a perfectly atomic snapshot would corrupt this way if recovered via
   `pg_resetwal`: heap pages lag the WAL, and `pg_resetwal` discards the WAL
   that crash recovery would have replayed to reconcile them. The fix must
   yield a snapshot whose crash recovery **succeeds**, so `pg_resetwal` is
   never reached.
2. `REINDEX` silently masks the index-level symptoms, so most index damage is
   never noticed; heap-level skew surfaces only when something happens to
   validate it (a constraint, a migration). "Works most of the time" describes
   the *detected* failure rate, not the actual one — restores that appear to
   succeed may carry undetected heap inconsistency.

These are not collation/locale corruption (a known, separate btree-corruption
cause that `pgro` already repairs): the affected indexes are non-text
(`_version_idx`, a `_pkey`), and "heap tid points past end of heap page" is a
structural skew error, not an ordering error.


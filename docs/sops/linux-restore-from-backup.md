# SOP: Restore a Linux server from backup

The restore of a Linux server's database is a developer and ops procedure with downtime planned.
No source in this repository records the restore commands, so this page lists what must be true around one and who decides.
**Restoring over a live database is ruled out** ([ruled-out actions](../ruled-out-actions.md#ruled-out-actions-never-suggest)); a restore here means onto a server that is stopped or freshly built, never a `pg_restore` or `psql` replay into a running Tamanu database.

All of this is **[dev-OTS]** except the checks.

## Checks first

1. The backup exists and is restorable: [check backups](linux-check-backups.md). **[diagnose]**
2. The key backup exists. A restore of the database refuses until one does ([bestool BAK, restore](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#restore)), and the key is what lets Tamanu read its stored secrets ([key pairing](../spec/linux/backups.md#key-pairing)). **[diagnose]**
3. The target is btrfs-backed for a snapshot restore, or has the space for a base-backup restore ([bestool BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#restore)). A restore is crash recovery: no `recovery.signal`, `restore_command` or `backup_label` is needed, and none should be added ([bestool BAK, the PostgreSQL method](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-postgresql-method)).
4. Whether this is a [clone](../spec/linux/backups.md#clone-deployments) (restoring from another deployment's backups), a rebuild of the same server, or a facility after data loss.

## What the restore does around the data

- A clone restore runs hooks: Tamanu stops, the identity scrub removes the source's sync identity and secrets, a fresh server key replaces the old one, Tamanu starts, and `/etc/bestool/clone-setup.sh` sets up each facility's sync account ([clone restore](../spec/linux/backups.md#clone-restore)).
- A restore of the `tamanu-secrets` type restarts the Tamanu services so containers pick up the restored key.
- A machine rebuild changes the machine id; what that does to the derived database passwords, and what to run afterwards, is in [credentials](linux-rotate-credentials.md).

## Afterwards

- A facility restored from backup can fail to sync with foreign-key conflicts: the Tamanu pack's [facility restored from backup](https://github.com/beyondessential/tamanu/blob/main/docs/runbooks/facility-restored-from-backup.md).
- A clone that does not sync: [clone not syncing](../runbooks/linux-clone-not-syncing.md).
- `bestool tamanu doctor` and the Canopy checks. **[diagnose]**

## Who

A developer, with a support officer present. Escalate with: deployment, which server, why a restore is wanted, the backup times Canopy shows, and whether sensitive data is involved.

# SOP: Upgrade PostgreSQL on a Linux server

A major version upgrade of the host PostgreSQL, run by the `postgres` role.
The requirements are in [LNXDB](../spec/linux/database.md#major-version-upgrades).
It stops the database for the length of the upgrade: **[dev-OTS]**, with downtime planned.

## 1. Check

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> \
  ansible-playbook -i inventory/canopy.yml postgres-upgrade-check.yml
```

**[diagnose]** Read the line it prints for each host.

| result | meaning | next |
|---|---|---|
| `NO_POSTGRES` | No `/var/lib/postgresql/current` link. | Nothing to upgrade. |
| `NO_UPGRADE_NEEDED` | Installed version equals `postgresql_version`. | Nothing to do. |
| `WILL_UPGRADE` | A new version is wanted and the data is on btrfs. | Continue. |
| `UPGRADE_BLOCKED` | A new version is wanted but `/var/lib/postgresql` is not btrfs (the line shows `fs=`). | The upgrade refuses. [Convert the layout](linux-convert-disk-layout.md) first. |
| `UNKNOWN` | None of the above. | Escalate. |

## 2. Prepare

- Take or confirm a recent backup ([check backups](linux-check-backups.md)). **[diagnose]**
- Confirm free space: `df -h /var/lib/postgresql` and `btrfs filesystem usage /var/lib/postgresql`. The upgrade clones files on btrfs and falls back to copying when cloning fails, which needs room for a second copy of the data. **[diagnose]**
- Set `postgresql_version` to the new major version and `postgresql_upgrade_enabled: true` in Canopy. A downgrade is refused.

## 3. Upgrade

Run `tamanu-install.yml --tags postgres --limit <host>` ([run the playbooks](linux-run-playbooks.md)). **[dev-OTS]**
In order, it creates a read-only snapshot `<subvolume>-pre-pgupgrade-<old>-to-<new>-<timestamp>` at the top level of the filesystem, installs the new version, copies the configuration, turns on data checksums on the old cluster if they are off (which rewrites every page and can take a long time), runs `pg_upgrade --check` and stops if it fails, upgrades, starts the new cluster, moves the `current` links, and starts `vacuumdb --all --analyze-in-stages` in the background.
It removes the old package but keeps the old cluster's data unless `postgresql_cleanup_old_cluster` is true.
The Tamanu services lose their connections when the old cluster stops; `tamanu-roll-on-postgres` rolls them when the new cluster starts.

## 4. After

- `pg_lsclusters` shows one online `main` on the new version, and the play's cluster check passes. **[diagnose]**
- `bestool tamanu doctor`, and the statistics rebuild finishing ([database runbook](../runbooks/linux-database-not-reachable.md)). **[diagnose]**
- The pre-upgrade snapshot and the old cluster's data keep using disk until removed. Removing either is destructive: leave it for a developer, and remove the data only after the new cluster has run cleanly for long enough, by setting `postgresql_cleanup_old_cluster` and re-running. **[dev-OTS]**

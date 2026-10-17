# Runbook: a clone deployment's facility does not sync after a restore

A clone deployment restored its servers from another deployment's backups, and a facility server cannot sync with the clone central, or Tamanu stayed stopped.
What the restore does is in [LNXBAK](../spec/linux/backups.md#clone-restore) and [clone setup](../spec/linux/ansible.md#clone-setup).
For fkey conflicts after a restore, the Tamanu pack's [facility restored from backup](https://github.com/beyondessential/tamanu/blob/main/docs/runbooks/facility-restored-from-backup.md) is a different problem: read it if sync errors name foreign keys.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
Passwords and the server key are **sensitive-data**: never print them.
**Do not restore the source's `tamanu-secrets`** onto a clone.

## 1. When this applies

The deployment is at Canopy rank `clone`, so its inventory has `tamanu_clone` true, and the restore has run.

## 2. Establish context

Which clone and facility, which source it was restored from, the Tamanu version (2.60.0 or later is set up automatically), whether central is in the same inventory. [Deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

**[diagnose]**

1. Tamanu is up: `bestool tamanu status`. The restore stops it and starts it after the scrub ([restore hooks](../spec/linux/backups.md#clone-restore)).
2. The restore log: `journalctl -u bestool-alertd --since "1 day ago"`. **[sensitive-data]**
3. The setup script and files exist. On the facility: `ls -l /etc/bestool/clone-setup.sh /etc/tamanu/clone-sync-password`. On the central: `sudo ls -l /etc/bestool/clone-sync/`. Each `<name>.password` holds 64 hex characters and a newline, so `wc -c` shows 65.
4. The sync account exists on central, by email only: `sudo -u postgres psql -X -d tamanu -c "SELECT email, role, kind, deleted_at FROM users WHERE email LIKE 'clone.%@sync.tamanu';"`. **[sensitive-data]**
5. Whether setup is automatic: the play prints `This clone's facilities are not set up against its central after a refresh` when central is outside the inventory or Tamanu is older than 2.60.0.
6. The server key was replaced: a restore of a clone gets a fresh `tamanu-config-key`; `sudo podman secret ls` shows it with a recent creation time.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Tamanu stopped, no `clone-setup.sh` run | A restore hook failed before the start, or the identity scrub failed (hooks run with errors fatal). | Read the daemon log; escalate. |
| `clone-setup.sh` missing | The play never wrote it: `tamanu_clone_auto_setup` is false. | Set up each facility by hand ([escalate](#6-escalate)). |
| Password file shorter than 64 characters | The account SQL changes nothing for a short password. | Delete the file on central, re-run `tamanu-install.yml`, run the script ([credentials](../reference/linux-credentials.md)). **[dev-OTS]** |
| No `clone.<name>@sync.tamanu` row | The central script did not run after the restore. | Run `/etc/bestool/clone-setup.sh` on the central, then on the facility. **[dev-OTS]** |
| Row present, facility still unsynced | The facility ran `setupSync` before central had the account, or its password differs. | Run the facility script again. **[dev-OTS]** |
| Facility syncs as the source's identity | The scrub did not run. | Escalate immediately: the clone can send as the source. Stop the facility from syncing first ([stop facility syncing](https://github.com/beyondessential/tamanu/blob/main/docs/sops/stop-facility-syncing.md)). **[dev-OTS]** |

## 5. Resolve

Order matters: central's script first (it runs the migrations that recreate the settings key and re-applies each facility's account), then each facility's script.
The scripts keep the password out of process arguments. **[dev-OTS]**

## 6. Escalate

Give the clone and source deployments, the Tamanu version, which of the files in step 3 exist, the redacted daemon log, and whether the facility may be syncing as the source.
For a clone that is set up by hand, a developer needs the facility's identifier and central's canonical URL.

# Runbook: a Linux server's backup is failing or missing

A backup check fails in Canopy, a backup is older than expected, or a restore refuses.
The definitions and the wiring are in [LNXBAK](../spec/linux/backups.md); how a PostgreSQL backup is captured is [bestool BAK](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#the-postgresql-method), and what a restore of it needs is [bestool BAK, restore](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/backup.md#restore).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
**Never delete, edit or change the retention of anything in the repository bucket**, and never change its versioning, lifecycle or policy: that is [ruled out](../ruled-out-actions.md#ruled-out-actions-never-suggest).

## 1. When this applies

A server's `tamanu-postgres`, `tamanu-config`, `tamanu-secrets`, `postgres-config` or `caddy-config` backup is not succeeding, or AWS Backup reports a failed, aborted or expired job.

## 2. Establish context

Which server and backup type, how old the last good one is, and whether the server is a clone, external or an instance. [Deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

Start with [check backups](../sops/linux-check-backups.md). **[diagnose]**
Run that SOP in full, then:

1. The error the daemon logged for that type: `journalctl -u bestool-alertd --since "2 days ago" | grep -i backup`. **[sensitive-data]**
2. Privileges: the daemon runs as root with `CAP_SYS_ADMIN`, granted for the `btrfs device stats` doctor check (`ansible/roles/bestool/templates/bestool-alertd.service.j2`).
3. The key backup: `tamanu-secrets` is missing on a restore refusal ([key pairing](../spec/linux/backups.md#key-pairing)).

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| No definition files in `/etc/bestool/backups` | The roles have not run, or removed them. | Run `tamanu-install.yml` ([dev-OTS](../sops/linux-run-playbooks.md)). |
| `tamanu-secrets.toml` absent on a clone | By design. | None. |
| Definitions present, daemon inactive | `bestool-alertd` is down. | `journalctl -u bestool-alertd`; escalate. Restarting it is **[dev-OTS]**. |
| Backup falls back to `pg_basebackup`, then fails for space | Not btrfs, or the staging directory has no room. | Free space ([disk pressure](linux-disk-pressure.md)) or escalate. |
| `AccessDenied` or credential errors fetching the repository | Canopy's issued credentials, or the role's trust or policy, is wrong ([roles](../spec/linux/backups.md#repository-roles)). | Escalate to whoever owns Canopy and the stack. Do not widen a policy. |
| Restore refused: no key snapshot | `tamanu-secrets` never ran. | `bestool canopy backup --type tamanu-secrets` takes it, not on a clone deployment, which carries no `tamanu-secrets` definition. **[dev-OTS]** |
| AWS Backup job failed | An instance snapshot problem, not the Canopy repository. | Read the job in AWS Backup; escalate. |
| An external server has no AWS Backup coverage | By design. | Rely on the Canopy repository. |

## 5. Resolve

Support's steps end at diagnosis. Re-running the roles or restarting the daemon is **[dev-OTS]**.

## 6. Escalate

Give the server, backup type, the last good time, the redacted daemon error, filesystem and free space, and whether `tamanu-secrets` exists.

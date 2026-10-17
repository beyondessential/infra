# Runbook: Tamanu cannot reach the database on a Linux server

The `db_connect` check fails, Tamanu logs a connection or authentication error, or a client on the tailnet cannot connect.
The database rules are in [LNXDB](../spec/linux/database.md).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
**Never `dropdb`, `createdb`, `pg_restore` or delete files under `/var/lib/postgresql`** ([ruled-out actions](../ruled-out-actions.md)).
For a psql session, use the Tamanu pack's [connect to psql](https://github.com/beyondessential/tamanu/blob/main/docs/sops/connect-psql.md). A session shows patient data: **[sensitive-data]**.

## 1. When this applies

PostgreSQL on a Linux server is stopped, refusing connections, or rejecting the password Tamanu presents.

## 2. Establish context

Which server, whether anything changed (a playbook run, a machine rebuild, a `salt` change, a PostgreSQL upgrade, a restart), and whether the host is a production server. [Deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

On the host. **[diagnose]**

1. The cluster: `pg_lsclusters` (one online `main`) and `systemctl status postgresql@<version>-main`.
2. Its log: `journalctl -u postgresql@<version>-main -n 200 --no-pager`. **[sensitive-data]**
3. The socket directory: `ls -ld /var/run/postgresql` (mode `drwxrwsr-x`, `postgres:postgres`).
4. Where it listens: `sudo ss -ltnp | grep 5432`, and `grep listen_addresses /etc/postgresql/current/main/postgresql.conf`.
5. Access rules: `sudo grep -vE '^\s*(#|$)' /etc/postgresql/current/main/pg_hba.conf`. It prints no secrets.
6. Space: `df -h /var/lib/postgresql` ([disk pressure](linux-disk-pressure.md)).
7. Role passwords match: the Tamanu log says `password authentication failed for user "tamanu"`.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Cluster `down`, log shows a crash or `No space left` | Disk full, or the process died. | [Disk pressure](linux-disk-pressure.md). The unit restarts after 30 seconds on failure. |
| `password authentication failed` for `tamanu`, `reporting` or `raw` | The derived password changed: the machine was rebuilt, or `salt` changed, and a run wrote new values to PostgreSQL but the services still hold the old ones (or the reverse). | Restart the services so they read `local.json5` and `/etc/tamanu/env` ([credentials](../sops/linux-rotate-credentials.md)). **[dev-OTS]** |
| A second online cluster, or `main` points elsewhere | An upgrade left the layout inconsistent. | Escalate; backups resolve the cluster by name. |
| `no pg_hba.conf entry` | A role or address without a rule: the Tamanu-managed `tamanu_reporting` and `tamanu_raw` roles and the Tamanu owner have local rules, and tailnet addresses `100.64.0.0/10` and `fd7a:115c:a1e0::/56` use `scram-sha-256`. | Check the connecting address and role. Re-running the roles restores the rules. |
| Local works, tailnet clients refused | `listen_addresses` does not include the Tailscale addresses, pending a restart. | [Restart pending](linux-postgres-restart-pending.md). |
| Connections refused during an upgrade | The old cluster stopped for `pg_upgrade`. | Wait for the play; [upgrade PostgreSQL](../sops/linux-upgrade-postgres.md). |
| After a restart, services error until restarted | Pooled connections were severed and the roll was skipped (no frontend active). | [Service down](linux-tamanu-service-down.md). |

## 5. Resolve

Support's steps end at diagnosis. A restart of PostgreSQL or Tamanu is **[dev-OTS]** ([restart PostgreSQL](../sops/linux-restart-postgres.md)).
Re-running `tamanu-install.yml --tags postgres` restores roles and rules ([run the playbooks](../sops/linux-run-playbooks.md)). **[dev-OTS]**

## 6. Escalate

Give the server, the PostgreSQL log lines (redacted), what changed beforehand, and the output of steps 1 to 5.

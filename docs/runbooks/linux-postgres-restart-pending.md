# Runbook: PostgreSQL restart pending on a production server

A playbook run printed that a PostgreSQL setting changed but the restart was left for you, or the `pg_tuning` check disagrees with the host.
Provisioning never restarts PostgreSQL on a production server, one whose Tailscale name contains `prod` ([LNXDB](../spec/linux/database.md#tuning)).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The run output said `postgres tuning changed parameters that require a restart` or `listen_addresses was changed but postgres was NOT restarted`, or a setting shown by `SHOW` differs from the one in the tuning rules.

## 2. Establish context

Which server, whether it is a production server by name, and when the run happened. A restart interrupts every Tamanu service on the host: [deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

**[diagnose]**

1. The pending settings: the pending query in step 1 of [restart PostgreSQL](../sops/linux-restart-postgres.md).
2. The value in force: `sudo -u postgres psql -X -c "SHOW shared_buffers;"` (or the named setting).
3. The stored value: `sudo grep -E 'shared_buffers|max_connections|io_method|huge_pages' /var/lib/postgresql/current/postgresql.auto.conf`.
4. The host's memory and CPU count, to check the tuning arithmetic against [LNXDB](../spec/linux/database.md#tuning): `free -k`, `nproc`.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| `pending_restart` true for `shared_buffers`, `max_connections`, `wal_buffers`, `huge_pages`, `max_worker_processes`, `io_method` or `autovacuum_max_workers` | A tuning change waits for a restart. | [Restart PostgreSQL](../sops/linux-restart-postgres.md) in a planned window. |
| `listen_addresses` lacks the Tailscale addresses | The server joined the tailnet after PostgreSQL was configured, or the change is pending. | The same restart. Until then remote tailnet clients cannot connect. |
| No pending rows, but a value differs from the rules | Tuning is off for the host (`postgresql_tune_enabled`), or the host's memory or CPUs changed since the last run. | Re-run `tamanu-install.yml --tags postgres --limit <host>` ([run the playbooks](../sops/linux-run-playbooks.md)). **[dev-OTS]** |
| A non-production server shows a pending restart | The run restarted it. | Run again, or restart ([SOP](../sops/linux-restart-postgres.md)). |

## 5. Resolve

Restart in a window agreed with the site: [restart PostgreSQL](../sops/linux-restart-postgres.md). **[dev-OTS]**
Do not edit `postgresql.auto.conf` by hand: the next run resets the tuned values.

## 6. Escalate

Escalate when the restart cannot wait for a window, or when the cluster does not come back ([database not reachable](linux-database-not-reachable.md)).

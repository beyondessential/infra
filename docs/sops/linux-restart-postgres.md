# SOP: Restart PostgreSQL on a Linux server

For a pending restart that provisioning left on a production server, or any planned restart.
A restart severs every Tamanu connection: **[dev-OTS]**, announced, outside clinic hours where the deployment has them ([deployment context](../deployment-context.md)).
The Tamanu pack's [restart services](https://github.com/beyondessential/tamanu/blob/main/docs/sops/restart-services.md) also classes it dev-OTS.

1. Confirm a restart is pending: **[diagnose]**

   ```sh
   sudo -u postgres psql -X -c "SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart;"
   ```

   The rows are the parameters that need a restart. Provisioning's restart rules are in [LNXDB](../spec/linux/database.md#tuning).
2. Confirm the Tamanu services are up, so the roll has something to do. `tamanu-roll-on-postgres` only runs when a frontend instance is active. `systemctl is-active tamanu-frontend@a tamanu-frontend@b` **[diagnose]**
3. Restart the cluster. **[dev-OTS]**

   ```sh
   pg_lsclusters
   sudo systemctl restart postgresql@<version>-main
   ```

4. `tamanu-roll-on-postgres.service` starts by itself and runs `bestool tamanu restart`: workers restart together, API and frontend one instance at a time. Watch it with `journalctl -u tamanu-roll-on-postgres -f`. **[diagnose]**
5. `pg_lsclusters` shows the cluster online, `bestool tamanu doctor` passes, and the pending query returns no rows. **[diagnose]**

If the cluster does not come back, see [database not reachable](../runbooks/linux-database-not-reachable.md).

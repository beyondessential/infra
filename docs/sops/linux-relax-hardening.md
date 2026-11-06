# SOP: Relax the hardening on a Linux server

Turn off one hardening switch on a server where the [kernel lockdown, service sandboxes or container restrictions](../spec/linux/server.md#confinement) break something, then re-run the role that owns it.
Each switch is an inventory variable ([inventory](../reference/linux-inventory.md)); set it at the machine's own scope in Canopy so the rest of the group keeps the hardening.
Changing a variable is **[dev-OTS]**, and so is the run ([run the playbooks](linux-run-playbooks.md)).
Turn off only the switch that the breakage points to, and put it back once the cause is fixed.

| breakage | variable | re-run | takes effect |
|---|---|---|---|
| Elastic Agent or another tool fails under kernel lockdown | `kernel_lockdown_enabled: false` | `--tags boot-parameters` | At the next reboot. The running kernel stays locked down until then. |
| PostgreSQL fails to start or cannot write a path | `sandboxes` without `postgres` | `--tags postgres` | When PostgreSQL next starts. A production server is not restarted by the run ([restart pending](../runbooks/linux-postgres-restart-pending.md)). |
| A Munin plugin reports nothing | `sandboxes` without `munin` | `--tags munin` | The run restarts munin-node. |
| A Tamanu or mSupply container fails to start or serve | `container_hardening_enabled: false` | `--tags tamanu` for Tamanu, `--tags msupply` for mSupply | When the container next restarts: `bestool tamanu restart` for Tamanu, `systemctl restart msupply` for mSupply. The run prints a warning until then. |

The run on a limited host is `tamanu-install.yml --tags <tag> --limit <host>`.
To find which restriction broke a service, read its unit's failure in `journalctl -u <unit>`, and `dmesg` for `apparmor="DENIED"` lines. **[diagnose]**
Report the breakage to a developer: the restriction should be fixed in the roles, not left off.

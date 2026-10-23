# Reference: Linux playbook variables

Per-server values come from the Canopy inventory ([inventory](linux-inventory.md)); anything not set there falls back to the role default.
The variables, their defaults and their meaning are defined by the spec that owns each subject:

- the Tamanu deployment: [LNXANS](../spec/linux/ansible.md#inventory-variables)
- the host: [LNXSRV](../spec/linux/server.md#inventory-variables)
- the Tamanu services and their proxy: [LNXRUN](../spec/linux/runtime.md#inventory-variables)
- the database: [LNXDB](../spec/linux/database.md#inventory-variables)
- the certificates: [LNXTLS](../spec/linux/tls.md#inventory-variables)
- mSupply: [LNXMSP](../spec/linux/msupply.md#enablement)

The rest of this page is what the specs do not carry: role arguments that the playbooks pass, variables set or derived by the plays rather than the inventory, and defaults that nothing reads.

## Role arguments

| argument | sets | notes |
|---|---|---|
| `type` | `tamanu_server_type` | `central` or `facility`, passed by the play. |
| `db_name` | `tamanu_db_name` | `tamanu`, passed by the play. |
| `db_user` | `tamanu_db_user` | Defaults to `db_name`. |
| `frontend_version` | `tamanu_frontend_version` | Role-argument form; the inventory sets `tamanu_frontend_version`. |

## Set or derived by the plays

| variable | default | notes |
|---|---|---|
| `tamanu_clone` | `false` | Set by the inventory plugin at rank `clone`. |
| `tamanu_clone_auto_setup` | derived | True for a clone with a central in the inventory and Tamanu 2.60.0 or later. |
| `tamanu_central_hostname` | derived | The hostname of `tamanu_central_canonical_url`. |
| `tamanu_facility_ids` | derived | `tamanu_facility_id` as a list: a list of one where it is a single identifier. The facility config, the clone setup script and the clone sync account read this rather than `tamanu_facility_id`. |
| `tailscale_name` | none | Hostname on the tailnet. Without it the `tailscale` role does not run. A name containing `prod` marks a production server. |
| `tailscale_tags` | none | With the name, writes the `ts-up` helper. Without it the helper is removed. |
| `podman_ipv6_enabled` | follows the host's default IPv6 route | Whether the IPv6 subnet is added to the default Podman network. |
| `alertd_db_role`, `alertd_cluster_db`, `alertd_app_db` | `alertd`, `postgres`, `tamanu` | The read-only monitoring role and the databases the daemon connects to. |

## Role defaults the specs do not name

| variable | default | notes |
|---|---|---|
| `tamanu_default_department`, `tamanu_default_location` | `GenericClinic` | Facility survey default codes. |
| `tamanu_country_name`, `tamanu_country_alpha2`, `tamanu_country_alpha3` | `Utopia`, `UT`, `UTO` | Central localisation. |
| `tamanu_letterhead_title`, `tamanu_letterhead_subtitle` | `Tamanu Health`, `BES International` | Defined, but no template or task reads them. |
| `caddy_email` | `tls-renewal@bes.au` | ACME contact. |
| `caddy_waf_enforce` | `false` | Defined, never read. |
| `postgresql_upgrade_detect_only` | `false` | Detect a needed major upgrade without performing it. |
| `mergerfs_version` | `2.40.2` | Defined, never read. |
| `munin_tailscale_port` | `4950` | Port of the Munin graphs site. |
| `baseline_syslog_excludes`, `baseline_syslog_exclude_prefixes` | see the role | Programs dropped from `/var/log/syslog` and still in the journal. |
| `podman_version`, `netavark_version`, `crun_version`, `bestool_version`, `starship_version`, `edit_version` | various | `podman_version`, `netavark_version`, `crun_version` and `bestool_version` are not read by the Linux server roles; the packages come from the BES repository. `bestool_version` is read by the Raspberry Pi role only. |

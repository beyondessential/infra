# Reference: Linux playbook variables

Variables the Linux playbooks read, with their defaults.
Per-server values come from the Canopy inventory ([inventory](linux-inventory.md)); anything not listed there falls back to the role default shown here.
The Tamanu-facing subset is also in [LNXAPP](../spec/linux/application.md#inventory-variables); the PostgreSQL subset is in [LNXDB](../spec/linux/database.md).
Do not put a secret in a tag: `salt` and `elastic_agent_enrollment_token` are secret variables.

## Identity and Tamanu

| variable | default | notes |
|---|---|---|
| `timezone` | none | Host time zone, `TZ` in `/etc/tamanu/env`, and Tamanu's `countryTimeZone`, `primaryTimeZone`. Required. |
| `salt` | none | Credential seed. Required for any play that derives a password. Secret. |
| `public_hostname` | none | Primary hostname. A trailing `.local` is cut from the system hostname and serves HTTP only. |
| `tamanu_central_canonical_url` | none | What facilities sync against. Its hostname feeds `tamanu_central_hostname`. |
| `tamanu_version` | `v2.10.0` | Used only where neither `version` nor the inventory sets it. |
| `tamanu_frontend_version` | `tamanu_version` | `frontend_version` is the role-argument form. |
| `tamanu_allow_downgrade` | unset | Set `true` to permit a lower `v` version. |
| `tamanu_facility_id` | none | Facility identifier. |
| `tamanu_central_ip` | `false` | An IP address, despite the boolean default. Writes an `/etc/hosts` line for the central hostname. |
| `patient_portal_fqdn` | none | Enables the patient portal on a central server. |
| `tamanu_ipv6` | `true` | `false` disables IPv6 inside Tamanu containers. |
| `tamanu_extra_certs` | `false` | Mounts the host certificate store into Tamanu containers. |
| `tamanu_default_department`, `tamanu_default_location` | `GenericClinic` | Facility survey default codes. |
| `tamanu_country_name`, `tamanu_country_alpha2`, `tamanu_country_alpha3` | `Utopia`, `UT`, `UTO` | Central localisation. |
| `tamanu_letterhead_title`, `tamanu_letterhead_subtitle` | `Tamanu Health`, `BES International` | Defined, but no template or task reads them. |
| `tamanu_clone` | `false` | Set by the inventory plugin at rank `clone`. |
| `tamanu_clone_auto_setup` | derived | True for a clone with a central in the inventory and Tamanu 2.60.0 or later. |

## Proxy and certificates

| variable | default | notes |
|---|---|---|
| `tamanu_caddy_tls` | `true` | `false` serves everything over HTTP. |
| `tamanu_caddy_extra_hostnames` | `[]` | Extra hostnames to serve. |
| `tamanu_caddy_extra_hostnames_redirect` | `true` | `false` serves each extra hostname as a real alias with its own certificate. |
| `tamanu_tailscale_tls` | `true` | Serve the `<tailscale_name>.<tailnet>.ts.net` site. |
| `tailnet` | `tail53aef` | Tailnet name part of the hostname. |
| `caddy_version` | `2.11.4-bes1` | Held package version. |
| `caddy_email` | `tls-renewal@bes.au` | ACME contact. |
| `caddy_zerossl_api_key` | unset | Adds ZeroSSL as an issuer. Secret. |
| `tamanu_caddy_tls_dns_iam` | unset | `access_key_id` and `secret_access_key`: switches the issuer to DNS-01 through Route 53. Secret. |
| `caddy_waf_enforce` | `false` | Defined, never read. |
| `caddy_canopy_certificates` | `true` | Sites ask `bestool-alertd` for certificates (needs `bestool` 2.2.0 or later). |

## Database

| variable | default | notes |
|---|---|---|
| `postgresql_version` | `18` | An installed version wins unless upgrades are enabled. |
| `postgresql_upgrade_enabled` | `false` | Allows a major upgrade. btrfs only. |
| `postgresql_upgrade_detect_only` | `false` | Detect without upgrading. |
| `postgresql_cleanup_old_cluster` | `false` | Removes the old cluster's data after an upgrade. |
| `postgresql_tune_enabled` | `true` | Applies the tuning. |
| `postgresql_tune_max_connections` | `100` | Also an input to `work_mem`. |
| `postgresql_tune_temp_file_limit` | empty | An explicit value (such as `10GB`) overrides the derived limit. |
| `postgresql_tune_temp_file_limit_percent` | `25` | Of the filesystem size, or of the btrfs quota where one is set. |
| `postgresql_btrfs_quota_percent` | unset | Caps the `@postgres` subvolume at this percentage of the filesystem. Quotas must already be enabled. |
| `alertd_db_role`, `alertd_cluster_db`, `alertd_app_db` | `alertd`, `postgres`, `tamanu` | The read-only monitoring role and the databases the daemon connects to. |
| `mergerfs_version` | `2.40.2` | Defined, never read. |

## Host

| variable | default | notes |
|---|---|---|
| `tailscale_name` | none | Hostname on the tailnet. Without it the `tailscale` role does not run. A name containing `prod` marks a production server. |
| `tailscale_tags` | none | With the name, writes the `ts-up` helper. Without it the helper is removed. |
| `ufw_managed` | `false` | Manage the host firewall rules. |
| `dangerously_leave_ufw_alone` | `false` | Skip the `ufw` role entirely. |
| `munin_enabled` | `true` | Run Munin. |
| `munin_tailscale_port` | `4950` | Port of the graphs site. |
| `elastic_agent_enabled` | `false` | With `elastic_agent_enrollment_token` installs and enrols; otherwise removes. |
| `elastic_agent_fleet_url` | the production Fleet | A development Fleet URL is in the role defaults as a comment. |
| `podman_ipv6_enabled` | follows the host's default IPv6 route | |
| `podman_network_subnets_v4`, `podman_network_subnets_v6` | `10.100.0.1/16`, `fd62:6573:b558:f686::1/64` | Gateway of the first IPv4 entry is where Caddy resolves container names. |
| `baseline_syslog_excludes`, `baseline_syslog_exclude_prefixes` | see the role | Programs dropped from `/var/log/syslog` and still in the journal. |
| `podman_version`, `netavark_version`, `crun_version`, `bestool_version`, `starship_version`, `edit_version` | various | `podman_version`, `netavark_version`, `crun_version` and `bestool_version` are not read by the Linux server roles; the packages come from the BES repository. `bestool_version` is read by the Raspberry Pi role only. |

## mSupply

| variable | default | notes |
|---|---|---|
| `msupply_enabled` | derived from the `MsupplyFQDN` tag | Set explicitly to override. |
| `msupply_hostname` | the `MsupplyFQDN` tag | Without it no Caddy site is written. |
| `msupply_tailscale_service` | the `MsupplyTailscaleService` tag | A `svc:` prefix is added where missing. |
| `msupply_version_amd64`, `msupply_version_arm64` | `v2.17.06-sqlite-amd64`, `v2.17.06-sqlite-arm64` | Image tags by architecture. |

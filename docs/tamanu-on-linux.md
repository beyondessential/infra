# Linux Tamanu Servers: Setup and Configuration

## 1. Architecture Overview

Each deployment is two layers:

1. **Pulumi** (`pulumi/tamanu/on-linux/`) — provisions AWS infrastructure: EC2 instances, EBS volumes, EIPs, security groups, Route53 records, IAM users for backups and ACME, and the Kopia S3 bucket. Also emits cloud-init that joins the box to Tailscale.
2. **Ansible** (`ansible/`) — configures the OS and deploys the application stack (PostgreSQL, Caddy, Podman, Kopia, Elastic Agent, Tamanu containers, optionally mSupply).

The handoff from Pulumi to Ansible is via **EC2 tags**. Pulumi writes tags like `Partitioning`, `TamanuServerType`, `PatientPortalFQDN`, `MsupplyFQDN`, and Ansible reads them at runtime (`ansible/tasks/fetch-ec2-tag.yml`) to branch behaviour. There is no SSM or parameter store handoff; tags are the whole protocol.

A deployment can also be **external** — Pulumi does not stand up an EC2 instance, just the DNS, ACME credentials, and backup bucket/user. The server itself is run on-premises or elsewhere, and Ansible connects to it directly.

The EC2 image is a custom Ubuntu 24.04 ARM64 AMI with btrfs root, shared from the Tamanu Internal account (`AMI_UBUNTU_ARM64` in common). The image itself is built from [`beyondessential/linux-images`](https://github.com/beyondessential/linux-images). Everything ARM/Graviton.

Tailscale ACLs, tags, and auto-approvals are defined in [`beyondessential/tailscale`](https://github.com/beyondessential/tailscale/). The `tag:server-tamanu*` tags referenced throughout this doc are declared there.

---

## 2. Pulumi Layer

### 2.1 Stack config — top-level knobs

Set in `Pulumi.{stack}.yaml` under the `tamanu-on-linux:` namespace.

| Key | Type | Default | What it does |
|---|---|---|---|
| `core` | string | **required** | Ref to the core infra stack (e.g. `bes/core/tamanu-example-prod`). Provides VPC, zone, tags. Checked against current AWS account on startup. |
| `namePrefix` | string | `''` | Prepended to all resource Name tags, e.g. `[Prod Linux] `. |
| `zoneId` | string | from core | Route53 hosted zone. Normally inherited. |
| `domainBase` | string | derived from stack+zone | Base FQDN for services. If no dot, treated as subdomain and suffixed with zone (`demo` → `demo.tamanu.app`). |
| `keyName` | string | `ops` | AWS EC2 key pair name for emergency SSH. |
| `hardDelete` | boolean | `false` | Disables EC2 termination protection. Off by default. |
| `patientPortalDomain` | string | `patient` | Label for the patient portal CNAME (prefixed to `domainBase`). Set empty to skip the record. |
| `tailscaleBase` | string | `tamanu-{root}-{type}` | Base for auto-generated Tailscale hostnames (`type` guessed from stack name: `demo`/`clone`/`prod`). |
| `tailscaleTags` | string (CSV) | `tag:server,tag:server-tamanu[,tag:server-tamanu-{root}][,tag:server-tamanu-{type}]` | Tailscale ACL tags applied to all nodes. |
| `ipAllowList` | list | unused | Declared but not referenced by anything at present. |
| `disk` / `disks.root` | number (GB) | `50` | Default root volume size. Per-instance override available. |
| `legacyDisk` | boolean | `false` | Use the old 3-volume layout (`/`, `/var/log` on `sdl`, `/var/lib/postgresql` on `sdp`). New installs leave this off — single btrfs root. The choice is surfaced to Ansible via the `Partitioning` EC2 tag (`split-data-logs` vs `single-btrfs`). |
| `cloneOf` | string (stack ref) | unset | Marks this stack as a clone of another `tamanu-on-linux` stack (e.g. `bes/tamanu-on-linux/example-prod`). Skips provisioning the Kopia bucket / IAM policies / users / role for this stack and re-exports the referenced stack's `backupBucket`, `backupUsers`, `backupReadOnlyUser` instead. EC2, DNS, AWS Backup, and ACME-DNS users still come from this stack. |

### 2.2 Central server

Under `central:` — an object, or `false` to skip central.

| Key | Default | Notes |
|---|---|---|
| `subdomain` | `central` | Hostname prefix under `domainBase`. |
| `instance` | `t4g.medium` | Bump for production (`t4g.large`, `t4g.xlarge`, etc.). |
| `disk` | stack default | Root volume (GB). |
| `legacyDisk` | stack default | Per-instance override. |
| `tailscaleName` | auto | Override Tailscale hostname. |
| `external` | `false` | Skip EC2; use `externalIps` instead. |
| `externalIps` | `[]` | Array of IPv4/IPv6 — A/AAAA records only, no instance provisioned. |

### 2.3 Facilities

Under `facilities:` — an array. Each entry produces one server.

| Key | Default | Notes |
|---|---|---|
| `id` | **required** | Auto-prefixed `facility-` if not already. |
| `name` | `{id}` | Display name for tags. |
| `subdomain` | `{id}` | Hostname. |
| `instance` | `t4g.medium` | AWS instance type. |
| `disk` | stack default | Root GB. |
| `legacyDisk` | stack default | 3-volume layout. |
| `tailscaleName` | auto | Override. |
| `external` / `externalIps` | `false` / `[]` | As above. Auto-enabled if `externalIps` is set. |
| `msupply` | `false` | `true` → CNAME `msupply.{subdomain}.{domainBase}`. String → custom domain prefix instead of `msupply`. Sets the `MsupplyFQDN` EC2 tag, which Ansible reads to auto-enable mSupply. |

### 2.4 Instance shape (`src/instances.ts`)

For every non-external server:

- **AMI** — custom Ubuntu 24.04 ARM64 (btrfs root).
- **Root EBS** — `gp3`, encrypted, ignore-changes on size.
- **Legacy extra volumes** (if `legacyDisk: true`) — `/dev/sdl` 10 GB for `/var/log`, `/dev/sdp` 50 GB for `/var/lib/postgresql`, both gp3+encrypted, `finalSnapshot: true`.
- **EIP** — static public IP.
- **Security** — IMDSv2 required, detailed monitoring on, `disableApiTermination` on unless `hardDelete`.
- **Cloud-init** (stored as a Pulumi `secret` because it contains the Tailscale auth key):
  1. Set hostname to FQDN.
  2. Install Tailscale.
  3. `tailscale up` with ephemeral auth key (6 h expiry), SSH enabled, tags and hostname from config.
  4. Drop a fixed emergency ed25519 pubkey (`emergency@tamanu`, the same one across every deployment) into `ubuntu`'s `authorized_keys` — fallback access if Tailscale is down.

**Tags written to the instance** (read by Ansible):

| Tag | Value |
|---|---|
| `Name` | `{namePrefix}{name}` |
| `FQDN` | full DNS name |
| `Partitioning` | `split-data-logs` (legacy) or `single-btrfs` |
| `TailscaleName` | Tailnet hostname |
| `TamanuServerID` | `central`, `facility-…` |
| `TamanuServerName` | display name |
| `TamanuServerType` | `central` or `facility` |
| `Purpose` | `tamanu-server` |
| `ManagedBy` | `pulumi` |
| `PatientPortalFQDN` | set on central if enabled |
| `MsupplyFQDN` | set on facility if `msupply` is configured |
| `TamanuCloneOf` | set if `cloneOf` is configured — value is the source stack ref |

### 2.5 DNS (`src/dns.ts`, `instances.ts`)

- **A/AAAA** at `{fqdn}` — either the EIP of the AWS instance or each entry in `externalIps`.
- **CNAME** `{patientPortalDomain} → central.{domainBase}` when central exists and the domain name is non-empty.
- **CNAME** `msupply.{subdomain}.{domainBase} → {subdomain}.{domainBase}` (or custom prefix) when `msupply` is set on a facility.

All records TTL 300.

### 2.6 ACME DNS-01 users (`src/acme-dns.ts`)

For every server that is `external` with at least one IP, an IAM user is created with a tightly-scoped Route53 policy — it can only create `_acme-challenge.{fqdn}` TXT records. Username exported as `acmeDnsUsers`. Operators create access keys manually and install them on the external box for Caddy to use.

A second policy for `_validation-persist.{fqdn}` is defined (for the upcoming Let's Encrypt `dns-persist-01` challenge type) but not yet attached.

### 2.7 Firewall (`src/firewall.ts`)

One security group per stack. Open to the world on:

- ICMP / ICMPv6 (all types/codes)
- TCP 80, TCP 443, UDP 443 (QUIC/HTTP3)

All egress allowed. Ingress/egress collections are `ignoreChanges` so manual SG edits aren't reverted.

### 2.8 Backup infrastructure (`src/backup/`)

**`aws.ts` — AWS Backup** (infrastructure snapshots):

- Vault `tamanu-on-linux-{stack}`.
- Three rules: daily (00:30 UTC, 7d retention), weekly (Sun 12:00, 4w), monthly (1st 00:00, 365d, cold-storage after 1d).
- Selects all EC2 instances + EBS volumes in the stack.

**`kopia.ts` — Kopia S3 bucket** (application backups):

- Bucket `bes-tamanu-kopia-backups-{stack}` with versioning, object lock (GOVERNANCE, 30-day minimum), TLS-required bucket policy, Pulumi `protect: true` (refuses to destroy even on `pulumi destroy`; the 30-day object lock enforces the same at the AWS level).
- `.storageconfig` object tells Kopia: blobs in INTELLIGENT_TIERING, indexes in STANDARD.
- One IAM user per server (exported as `backupUsers`) with read/write on their own paths.
- One `backupReadOnlyUser` for restore operations.
- A `backupIamRole` for EC2 instance profile use.

When the stack sets `cloneOf: bes/tamanu-on-linux/<other>` none of the above is provisioned — `backupBucket`, `backupUsers`, and `backupReadOnlyUser` are re-exported from the referenced stack instead. Clone hosts use the source stack's bucket and credentials directly (kopia separates snapshot sources by hostname inside the repo, so writes don't collide).

---

## 3. Ansible Layer

### 3.1 Playbooks

| Playbook | Purpose |
|---|---|
| `base-install.yml` | OS baseline. Runs `baseline`, `toolbox`, optional `tailscale`, `podman`. Nothing Tamanu-specific. |
| `tamanu-install.yml` | Full stack: EBS volume attach (if `Partitioning=split-data-logs`), PostgreSQL, Caddy, Kopia, Elastic Agent, metrics cleanup, then the DB + `tamanu-single-install` role. Optionally mSupply on facility when `MsupplyFQDN` tag or `msupply_enabled` is set. |
| `tamanu-upgrade.yml` | Three-phase upgrade. Pre-phase makes install idempotent; upgrade phase does blue/green frontend swap, patient-portal restart, DB migration, API/tasks/sync restart; post-phase reloads Caddy. |
| `postgres-upgrade-check.yml` | Read-only — detects whether a major-version PG upgrade is needed and possible. Outputs one of `NO_POSTGRES`/`NO_UPGRADE_NEEDED`/`WILL_UPGRADE`/`UPGRADE_BLOCKED`/`UNKNOWN`. Blocks on non-btrfs filesystems. |
| `convert-three-disk-to-btrfs.yml` | Incremental, stateful migration from the legacy 3-volume layout to single btrfs. Tracks progress in `/root/.disk-conversion-metadata-v2.json`. |

### 3.2 Inventory shape

Inventory comes from Canopy. `ansible/inventory/canopy.yml` names no deployment: the run picks one with `CANOPY_GROUP` and `CANOPY_RANK`, and reading it needs Canopy administrator access, since the inventory carries the deployment's secret variables. The plugin is `ansible/inventory_plugins/canopy.py`.

The per-deployment files under `ansible/inventory/{deployment}.yml` are what that replaces, and they remain the reference for the shape Canopy has to serve. Typical example:

```yaml
all:
  vars:
    timezone: Pacific/Auckland
    salt: <uuid>
    tamanu_central_canonical_url: https://sync.example.org
    tamanu_version: v2.50.5
  children:
    central:
      hosts:
        tamanu-example-prod-central-linux:
          ansible_user: ubuntu
          public_hostname: central.prod.example.tamanu.app
          tamanu_caddy_extra_hostnames: [sync.example.org]
          tamanu_caddy_extra_hostnames_redirect: false
          tailscale_name: tamanu-example-prod-central-linux
    facility:
      hosts:
        tamanu-example-prod-facility-a-linux:
          ansible_user: bes-dev
          public_hostname: facility.a.example.tamanu.app
          tailscale_name: tamanu-example-prod-facility-a-linux
          tamanu_facility_id: facility-ExampleHospital
```

Key per-deployment variables (the "top of the inventory" set):

| Variable | Purpose |
|---|---|
| `canopy_intent` | What the run may do. The upgrade playbooks refuse an inventory that does not say `upgrade`, since Canopy checks for an upgrade plan only when it is asked for one. |
| `timezone` | Host `timedatectl`. |
| `salt` | Seed for deterministic DB password generation. Combined with machine ID + username → scram-sha-256 password. |
| `tamanu_central_canonical_url` | The canonical URL facilities sync against. |
| `tamanu_version` | Default Docker image tag (can also be set on central/facility). |
| `tamanu_central_ip` | Skip DNS for central, hit it on the private IP. |
| `elastic_agent_enabled`, `elastic_agent_enrollment_token` | Monitoring/EDR. |

`salt` and `elastic_agent_enrollment_token` are secret variables in Canopy rather than tags, held in the same store as a group's backup passphrase. A name is one or the other, never both.

Per-host:

| Variable | Purpose |
|---|---|
| `ansible_user` | SSH user (`ubuntu`, `bes-dev`…). |
| `public_hostname` | Primary FQDN (used by Caddy for TLS). |
| `tailscale_name`, `tailscale_tags` | Registers the box in the Tailnet. |
| `tamanu_facility_id` | Facility identifier in Tamanu itself. |
| `patient_portal_fqdn` | Enables the patient portal on a central server. |
| `msupply_hostname` | Enables mSupply on a facility. |

### 3.3 Roles

#### Infrastructure / base

**`baseline`** — Locales (en_US/AU/GB/NZ), timezone, BES repo, APT auto-update, SSH auto-upgrade, journald tuning, network tuning (BBR, `tcp_slow_start_after_idle=0`), btrfs maintenance, snapper installed for postgres backup snapshots only (root timeline disabled, any non-postgres configs purged), Kopia user, psacct.

**`toolbox`** — Operator tooling. Knobs: `bestool_version` (1.2.2), `starship_version` (1.24.1), `edit_version` (1.2.0). Installs `tsw` (Tailscale wrapper), tmux/htop configs, shell completions.

**`common`** — Just default snapper retention (`snapper_timeline_settings`: all zero — postgres backup snapshots are short-lived and get cleaned up on the next `snapper-cleanup.timer` firing).

**`ebs-volume`** — Parameterised role invoked per-volume. Args: `volume` (NVMe alias like `sdl`), `mount`, `fs_type`, `mount_opts`, optional `fs_opts`. Maps NVMe alias → real device, formats, moves existing data, mounts via fstab.

**`tailscale`** — Needs `tailscale_name`. Optional `tailscale_tags`. Writes a `ts-up` script with auth key, registers the node, enables Caddy `TS_PERMIT_CERT_UID` so Caddy can read tailnet certs.

**`podman`** — `podman_version` (5.5.0), `netavark_version` (1.15.0), `crun_version` (1.21). `podman_ipv6_enabled` auto-detected. Networks default to `10.100.0.1/16` (v4), `fd62:6573:b558:f686::1/64` (v6), overridable via `podman_network_subnets_v4/_v6`.

**`elastic-agent`** — `elastic_agent_enabled` (default false), `elastic_agent_enrollment_token`, `elastic_agent_fleet_url` (default Elastic Cloud AU East). Enrols, installs, or uninstalls depending on state.

#### Data

**`postgres`** — `postgresql_version` (default 18). Detects installed version via symlink/`psql`/systemd/`dpkg`. `postgresql_upgrade_enabled` (default false) does in-place major-version upgrades but refuses on ext4 (btrfs only). `postgresql_upgrade_detect_only` for dry run. `postgresql_cleanup_old_cluster` to reclaim space after an upgrade. Creates `/etc/postgresql/current` and `/var/lib/postgresql/current` symlinks to the active version; APT-hold on the package; configures pg_hba for local socket; sets up WAL archiving.

**`postgres-database`** — Parameterised: `dbname`, `username` (default = dbname), `create_user` (true), `unix_socket` (true). Passwords are scram-sha-256 hashes derived from machine ID + `salt` + username (deterministic, not stored in inventory).

#### App-layer

**`caddy`** — `caddy_version` (2.10.2), `caddy_email` (`tls-renewal@bes.au`), `caddy_waf_enforce` (false), optional `caddy_zerossl_api_key` (uses ZeroSSL as ACME CA), optional `tamanu_caddy_tls_dns_iam` (Route53 DNS-01 credentials for external servers — paired with the Pulumi ACME user from §2.6). Socket-activated (`caddy.socket` → `caddy.service`). On-AWS servers get Let's Encrypt HTTP-01 (via public 80/443) plus Tailscale magic-DNS certs; external servers use DNS-01 through the scoped IAM user.

**`kopia`** — Installs client, sets backup + cache + retention policies. Runs maintenance only on central (`'central' in group_names`).

**`metrics-cleanup`** — Prunes logs/metrics on a timer.

**`tamanu-single-common`** — Shared vars for install and upgrade. Defaults:

| Var | Default | Meaning |
|---|---|---|
| `tamanu_version` | `v2.10.0` | Image tag. |
| `tamanu_db_name` | from `db_name` | DB to connect to. |
| `tamanu_db_user` | `{{ db_name }}` | DB user. |
| `tamanu_server_type` | from `type` | `central` or `facility`. |
| `tamanu_image_server` / `_frontend` / `_patient_portal` | `ghcr.io/beyondessential/…` | Overridable. |
| `tamanu_default_department` / `_location` | `GenericClinic` | |
| `tamanu_letterhead_title` / `_subtitle` | `Tamanu Health` / `BES International` | Report header. |
| `tamanu_country_name` / `_alpha2` / `_alpha3` | `Utopia` / `UT` / `UTO` | |
| `tamanu_ipv6` | `true` | Disable to work around Happy Eyeballs stalls in containers. |
| `tamanu_central_hostname` | parsed from `tamanu_central_canonical_url` | |
| `tamanu_central_ip` | `false` | Hit central on private IP instead of DNS. |
| `tamanu_caddy_tls` | `true` | TLS to upstream containers. |
| `tamanu_caddy_extra_hostnames` | `[]` | Extra SAN / vhost aliases. |
| `tamanu_caddy_extra_hostnames_redirect` | `true` | Redirect extras to primary (set false for real aliases such as a site's own `sync.` domain). |
| `tamanu_extra_certs` | `false` | Mount `/etc/ssl/certs` into containers for corporate CAs. |
| `tamanu_ufw_firewall` | `false` | Enable UFW on the host. |
| `tailnet` | `tail53aef` | Tailnet name for Magic DNS. |
| `tamanu_tailscale_tls` | `true` | Use Tailscale-issued certs on the tailnet name. |

**`tamanu-single-install`** — Creates `tamanu` user, writes `central.json5` or `facility.json5` where the host has none, stands up systemd quadlets:

- `tamanu-frontend@a`, `tamanu-frontend@b` — two frontend instances for blue/green.
- `tamanu-patientportal` — if enabled on central.
- `tamanu-{type}-api@1`, `tamanu-{type}-api@2` — API workers.
- `tamanu-{type}-tasks` — background jobs.
- `tamanu-{type}-sync` — sync daemon.
- `tamanu-central-fhir-refresh`, `tamanu-central-fhir-resolve` — central FHIR indexers.

A new facility gets no sync credentials and comes up unconfigured, serving the setup wizard, which mints a per-device sync user.

Writes quadlet drop-ins for IPv6 (`noipv6.conf`) and CA mount (`host-ca-certs.conf`) depending on config. Adds Caddy upstream + server blocks. Installs the `tamanu-backup` timer. Patient portal auto-enables on central from the EC2 `PatientPortalFQDN` tag, or from `patient_portal_fqdn` var.

**`tamanu-single-upgrade`** — Stops old, pulls new, staggered frontend restart with DNS-flip delay, patient-portal restart, `tamanu-run migrate`, API/tasks/sync restart, legacy-service cleanup.

**`msupply-common`** — `msupply_version_amd64` / `_arm64` pins.

**`msupply-install`** — Enabled by EC2 tag `MsupplyFQDN` or explicit `msupply_enabled: true` with `msupply_hostname`. Picks image by arch, writes `/etc/msupply/local.yaml`, quadlet `msupply.container`, Caddy vhost, persistent volume, UFW rules if enabled.

**`msupply-upgrade`** — Restart the service.

---

## 4. Feature Flags (the full toggle list)

| Flag | Where | Default | Effect |
|---|---|---|---|
| Tailscale | `tailscale_name` (Ansible) / cloud-init (Pulumi) | on | VPN + Magic DNS certs. |
| Elastic Agent | `elastic_agent_enabled` | off | EDR/observability. |
| Kopia | always on in `tamanu-install.yml` | on | S3 application backups. |
| AWS Backup | Pulumi (always created when stack has AWS instances) | on | EBS/EC2 snapshots. |
| Patient portal | EC2 tag `PatientPortalFQDN` or `patient_portal_fqdn` | off | Central-only extra container. |
| mSupply | EC2 tag `MsupplyFQDN` or `msupply_enabled` | off | Facility-side supply chain service. |
| UFW | `tamanu_ufw_firewall` | off | Host firewall. Usually off in favour of SG + Tailscale. |
| IPv6 in containers | `tamanu_ipv6` | on | Off avoids Happy Eyeballs stalls. |
| Host CA certs | `tamanu_extra_certs` | off | Mount host `ca-certificates.crt` into containers. |
| PG auto-upgrade | `postgresql_upgrade_enabled` | off | In-place major upgrade. Btrfs only. |
| Legacy disk layout | `legacyDisk` (Pulumi) | off | 3-volume layout instead of single btrfs. |
| Hard delete | `hardDelete` (Pulumi) | off | Allow EC2 termination. |
| External | `external` / `externalIps` (Pulumi) | off | No EC2; DNS + ACME user only. |

---

## 5. Config Patterns by Scale

**Small dev** — 1 central + 2 facilities, all `t4g.medium`, 50 GB, single btrfs, auto-everything.

```yaml
tamanu-on-linux:namePrefix: '[Demo Linux] '
tamanu-on-linux:tailscaleBase: tamanu-example-demo
tamanu-on-linux:facilities:
  - { id: a, name: Facility A, subdomain: facility-a }
  - { id: b, name: Facility B, subdomain: facility-b }
```

**Production with a bigger central + one on-prem facility**:

```yaml
tamanu-on-linux:central:
  instance: t4g.xlarge
  disk: 200
  tailscaleName: tamanu-example-prod-central-linux
tamanu-on-linux:facilities:
  - { id: lab, name: Lab, external: true }
```

**Mixed AWS / on-prem with mSupply everywhere**:

```yaml
tamanu-on-linux:domainBase: example.tamanu.app
tamanu-on-linux:central: { instance: t4g.large }
tamanu-on-linux:facilities:
  - { id: north, subdomain: north, externalIps: [10.0.1.7], msupply: true }
  - { id: south, subdomain: south, externalIps: [10.0.2.7], msupply: true }
```

**Facility-only (no central) fallback**:

```yaml
tamanu-on-linux:central: false
tamanu-on-linux:facilities: [{ id: a, name: Facility A }]
```

---

## 6. Standing up a new deployment (typical flow)

1. **Write `pulumi/tamanu/on-linux/Pulumi.{stack}.yaml`** — choose `core`, instance sizes, facility list, external IPs if any.
2. **`pulumi up`** the stack. This creates EC2, DNS, SGs, S3 bucket, IAM users.
3. **Pull IAM credentials** — `pulumi stack output backupUsers acmeDnsUsers`, create access keys, distribute to each host.
4. **Write `ansible/inventory/{deployment}.yml`** — set `timezone`, `salt`, `tamanu_central_canonical_url`, `tamanu_version`, and per-host `public_hostname`, `tailscale_name`, `tamanu_facility_id`, optional portal/mSupply hostnames.
5. **Run `base-install.yml`**, then **`tamanu-install.yml`** (it reads EC2 tags to decide about EBS mounts, patient portal, mSupply).
6. **Subsequent upgrades** — bump `tamanu_version`, run `tamanu-upgrade.yml`. For PG major-version changes, first run `postgres-upgrade-check.yml` to confirm the FS is btrfs.

---

## 7. Gotchas

- **DB passwords are never stored.** Derived from `salt` (inventory) + machine ID + username into a scram-sha-256 hash. Deterministic — but rotating the salt or rebuilding the machine rotates every password.
- **`tamanu_central_ip`** — switches facilities to reach central on a private/Tailscale IP instead of the public FQDN, dodging an unnecessary internet round-trip. Easy to overlook because it's gated on a boolean-looking variable that's actually an IP string.

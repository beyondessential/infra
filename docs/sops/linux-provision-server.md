# SOP: Provision a Linux Tamanu server

Stand up a deployment's servers, or add one.
Every step that changes infrastructure or a host is **[dev-OTS]**.
Agents run previews only and never `pulumi up` ([AGENTS.md](../../AGENTS.md)).
The stack config reference is [Linux stack config](../reference/linux-pulumi-config.md).

## 1. Infrastructure

1. Write `pulumi/tamanu/on-linux/Pulumi.<stack>.yaml`: `core`, the facility list, instance sizes, `external` or `externalIps` for servers outside AWS, `canopyInfra` and `serverGroupId` for backups. Set secrets with `pulumi config set --secret`. The file is gitignored; keep it that way.
2. Preview with the policy pack: build it with `npm run build` in `pulumi/policies`, then `pulumi preview --policy-pack <path to pulumi/policies>`. **[diagnose]**
3. A human runs `pulumi up`. **[dev-OTS]** It creates instances with their Elastic IPs, DNS records, the security group, the AWS Backup plan, the repository bucket and roles, and DNS-01 users for external servers.
4. A new instance runs its first-boot user data and joins the tailnet with a key that is valid for 6 hours and works once. If the join fails (an Elastic IP quota is the example in the code), fix the cause within that window or the instance needs a new key ([server unreachable](../runbooks/linux-server-unreachable.md)).

## 2. An external server

1. On the host, as root, run `check-server-ready.sh` from the repository root. **[diagnose]** It checks Ubuntu 24.04 or later, a btrfs root mounted from `@`, a btrfs `@postgres` mounted at `/var/lib/postgresql`, Tailscale and `netcheck`, IPv6, NTP, and HTTPS to the hosts the install needs. It exits non-zero only for disk or operating system failures; network failures are warnings. It prints what to do for each failure.
2. For a root that is ext4 on LVM, see [convert a disk layout, LVM and ext4 to btrfs](linux-convert-disk-layout.md#lvm-and-ext4-to-btrfs).
3. Create access keys for the IAM user named in the `acmeDnsUsers` output and store them as the secret variable `tamanu_caddy_tls_dns_iam` in Canopy ([rotate credentials](linux-rotate-credentials.md)). **[dev-OTS, sensitive-data]**

## 3. Canopy and inventory

In Canopy, mark each machine `managed_by_ansible` and set the variables: group-wide `timezone`, `tamanu_central_canonical_url`, `tamanu_version` and the secret `salt`; per host `public_hostname`, `tailscale_name`, `tamanu_facility_id`, and where needed `patient_portal_fqdn`, `msupply_hostname`, `tamanu_central_ip`. [Variables](../reference/linux-variables.md) lists the rest.
Do not put a secret in a tag.

## 4. Configure

Run `base-install.yml` then `tamanu-install.yml` ([run the playbooks](linux-run-playbooks.md)).
`tamanu-install.yml` reads the instance tags to decide about volumes, the patient portal and mSupply.

## 5. Check

- `bestool tamanu doctor` on each host and the checks in Canopy. **[diagnose]**
- The first backup of the server key is taken automatically when the definitions land; confirm it ([check backups](linux-check-backups.md)).
- The hostname answers over HTTPS with a certificate ([certificate not served](../runbooks/linux-certificate-not-served.md)).
- A facility server comes up with no sync credentials, so it still needs setting up against central in Tamanu.

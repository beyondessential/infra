# Reference: Linux deployment stack config and outputs

The `tamanu-on-linux` Pulumi stack (`pulumi/tamanu/on-linux`) provisions one deployment: its instances, DNS, security group, instance snapshots, backup bucket and roles, and DNS-01 users.
The requirements are in [LNXAWS](../spec/linux/aws.md), [LNXMSP](../spec/linux/msupply.md#provisioning) and [LNXBAK](../spec/linux/backups.md#repository-bucket).
Stack config (`Pulumi.<stack>.yaml`) is gitignored: values go in with `pulumi config set`, secrets with `--secret`, never in source.
Run previews as `pulumi preview --policy-pack <path to pulumi/policies>` after `npm run build` in `pulumi/policies`; never `pulumi up` from an agent ([ruled-out actions](../ruled-out-actions.md#consequential-but-recoverable-dev-ots)).
All keys are under the namespace `tamanu-on-linux:` except `billing:`.

The instance image is built from the `beyondessential/linux-images` repository and shared into the account; its id is per region in `pulumi/constants/internal.ts`.
Tailscale ACLs, tags and auto-approvals live in the BES tailnet policy repository, not here.

## Deployment keys

| key | default | what it does |
|---|---|---|
| `core` | required | Core stack providing the VPC, zone and tags. The stack refuses to run in any other AWS account. |
| `namePrefix` | empty | Prefix of every `Name` tag. |
| `zoneId` | from core | Route 53 zone, normally inherited. |
| `domainBase` | derived from stack name and zone | Base of every hostname. A value without a dot becomes a subdomain of the zone. |
| `patientPortalDomain` | `patient` | Label of the patient portal hostname. Empty means none. |
| `tailscaleBase` | `tamanu-<zone root>-<demo, clone or prod>` | Base of Tailscale names. The type is guessed from the stack name. |
| `tailscaleTags` | `tag:server`, `tag:server-tamanu`, `tag:server-tamanu-<root>`, `tag:server-tamanu-<type>` | Comma-separated. The tags are declared in the BES tailnet policy repository. |
| `msupplyTailscaleTags` | `tag:server-msupply`, plus `-<root>` and `-<type>` | Tags of the mSupply Tailscale service. |
| `disk`, `disks.root` | `50` | Root volume size in GiB. |
| `legacyDisk` | `false` | `true` selects the [split layout](../spec/linux/aws.md#partitioning) and the tag `Partitioning=split-data-logs`. |
| `hardDelete` | `false` | `true` turns off termination protection. |
| `cloneOf` | unset | A `tamanu-on-linux` stack reference. Skips this stack's bucket, roles and users and re-exports the source's. Writes the tag `TamanuCloneOf`. |
| `canopyInfra` | required | A `canopy-infra` stack reference. The backup roles trust Canopy's roles from it ([roles](../spec/linux/backups.md#repository-roles)). |
| `serverGroupId` | unset | Registers the bucket and roles with Canopy. |
| `retired`, `retiredTargetBase`, `retiredHostMap` | `false`, unset, empty | [Retire a deployment](../sops/linux-retire-deployment.md). |
| `billing:product`, `billing:stage`, `billing:deployment` | `tamanu`, the type guessed from the stack name or `prod` when none can be, unset | Become `billing.*` tags on every resource. |
| `keyName`, `ipAllowList` | `ops`, unset | Read into constants that nothing uses. |

## Servers

`central` is an object, or `false` for a deployment without a central server.
`facilities` is a required list; each entry makes one server.

| key | default | notes |
|---|---|---|
| `id` (facility) | required | Prefixed with `facility-` if it does not start with it. |
| `name` (facility) | the id | Display name in tags. |
| `subdomain` | `central`, or the facility id | Hostname label. |
| `instance` | `t4g.medium` | Size a busy central up (`t4g.large` or more) in config, not in the default. |
| `disk`, `legacyDisk` | deployment value | Per-server override. |
| `tailscaleName` | `<tailscaleBase>-central` or `-facility-<id>` | |
| `external`, `externalIps` | `false`, `[]` | No instance; DNS from the addresses. Listing any address implies `external`. |
| `dnsUser` | `false` | Also creates the DNS-01 user for a server that is not external. |
| `msupply` | `false` | `true` makes `msupply.<subdomain>.<domainBase>`, a string makes `<string>.<domainBase>`. Sets the `MsupplyFQDN` and `MsupplyTailscaleService` tags and creates a Tailscale service. |

```yaml
# small deployment: one central, two facilities, all defaults
tamanu-on-linux:namePrefix: '[Demo Linux] '
tamanu-on-linux:facilities:
  - { id: a, name: Facility A, subdomain: facility-a }
  - { id: b, name: Facility B, subdomain: facility-b }

# larger central and one on-premises facility
tamanu-on-linux:central: { instance: t4g.xlarge, disk: 200 }
tamanu-on-linux:facilities:
  - { id: lab, name: Lab, external: true }

# facility only
tamanu-on-linux:central: false
tamanu-on-linux:facilities: [{ id: a, name: Facility A }]
```

## Outputs

| output | what |
|---|---|
| `urls` | Public and Tailscale address of each server, patient portal and mSupply. |
| `tailscaleTags` | Tags in force. |
| `backupBucket`, `bucketArn` | The repository bucket. |
| `deviceRoleArn`, `maintenanceRoleArn` | The two repository roles. |
| `acmeDnsUsers` | IAM user names for DNS-01. Create their access keys by hand ([rotate credentials](../reference/linux-credentials.md)). |
| `redirectsTo` | Hostname to target map of a retired deployment. |

A retired deployment exports no server outputs; `facilities` is still required because the redirected hostnames derive from it.

## Other stacks

`pulumi/backups` makes a standalone Kopia repository bucket (`bes-kopia-backups-<stack>` unless `bucketName` is set) with the same lock, versioning and roles, for repositories that are not Tamanu deployments: one stack per repository.
Its config keys are `bucketName`, `tags` (a map, on top of `Purpose: backups`), the required `canopyInfra`, and `serverGroupId`.
By convention a bucket name begins with `bes-` and contains `kopia-backups`, and avoids the prefix `bes-tamanu-kopia-backups`, which is the Tamanu deployment pattern.
`pulumi/backup-monitoring` forwards failed, aborted and expired AWS Backup jobs from every account to a central event bus ([LNXBAK](../spec/linux/backups.md#backup-failure-notification)).

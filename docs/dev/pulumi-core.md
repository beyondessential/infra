# The Core Account Stack

`pulumi/core/` is the foundational per-account stack. One stack per AWS account. It sets up the baseline the account needs before any workload stack can run: the VPC, a Route53 zone, account-level security (EBS encryption default, CloudTrail, IAM password policy), GitHub Actions OIDC, CloudWatch alarms, and the Spot data feed.

Internal doc with the full context: <https://beyond-essential.slab.com/posts/aws-account-core-39tz152u>.

Every other stack in this repo that provisions AWS resources (or K8s workloads that need AWS) reads from a core stack via `cfg.require('core')`. See `docs/dev/pulumi-organisation.md` for that mechanism.

---

## 1. What it provisions

Order of operations in `src/index.ts`:

1. IAM account password policy (`src/passwords.ts`).
2. SNS alerts topic + CloudWatch alarms (`src/alerts.ts`).
3. Default EBS encryption (`src/ebs-encryption.ts`).
4. CloudTrail trail + S3 bucket (`src/cloudtrail.ts`).
5. Network — VPC, subnets, NAT, IGW, Flow Logs, S3 gateway endpoint (`src/network.ts`).
6. Route53 zone + management policy (`src/zone.ts`).
7. GitHub Actions OIDC provider (`src/oidc.ts`, when `withGithubOidc`).
8. EKS CNI IPv6 policy (`src/policy.ts`, when `networkV6` and `forEksCluster`).
9. Spot Data Feed S3 bucket (`src/spot-data-feed.ts`).

### 1.1 Network

- VPC CIDR: default `10.{last two digits of account ID}.0.0/16`. Overridable via `networkV4`.
- IPv6: `/56` per region, `/64` per AZ, on by default.
- Three subnet tiers per AZ (each optional):
  - **NAT subnets** — always present. Small (/28), hold NAT gateways, IGW attachment.
  - **Workload subnets** (private) — when `privateSubnets` (or `forEksCluster`).
  - **Public workload subnets** — when `publicSubnets` (default on).
- VPC Flow Logs → CloudWatch `/aws/vpc/flowlogs/core-network`, 30 day retention, REJECT-only.
- S3 gateway endpoint, routed from every subnet tier. Free, so unconditional.
- RDS DB subnet group made from the private workload subnets when present.

All exported as `network` (a `NetworkOutputs` object: VPC ID, CIDR, NAT/workload/public subnet ID lists, IPv6 info).

### 1.2 Route53 zone

Creates (or imports, if `zoneImport` is set) a public hosted zone. Also creates a managed IAM policy — `zoneMgmtPolicy` — that grants `route53:ChangeResourceRecordSets` / `ListResourceRecordSets` on this zone only, plus list-all-zones. cert-manager, external-dns, Caddy on the Linux boxes, and ACME users from `tamanu-on-linux` all attach this policy.

If `domain: false` is set, the zone is skipped entirely.

### 1.3 Security baselines

- **Password policy**: min 15 chars, no expiry (intentionally — forced rotation reduces entropy), no reuse of the last 24, users can self-change.
- **CloudTrail**: multi-region account trail, includes global services. Bucket `bes-{stack}-cloudtrail` (override with `trailBucket`). Versioning + log-file validation on. Current logs retained forever; non-current versions pruned at 90 days, whole objects at 365.
- **Default EBS encryption**: on, using `alias/aws/ebs` (AWS-managed, not a custom KMS key).

### 1.4 Alerts

SNS topic `workload-alerts`, email-subscribed. Two CloudWatch alarms wired to it:

- `OverallHighCPU` — any EC2 instance over 80% CPU (max) for 2×2 h windows.
- `CPUCreditsCharged` — any T-family instance racking up surplus credits (sum > 60 min over 2×5 min windows).

### 1.5 GitHub Actions OIDC

Provider `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`, thumbprints hard-coded in `constants/external.ts`. Exported as `ghaOidc` — downstream stacks build role trust policies against it so GitHub workflows can deploy without static AWS creds.

### 1.6 Spot Data Feed bucket

`bes-spot-data-feed-{accountId}`, 30 day lifecycle. Wired to AWS's Spot Instance data feed service. OpenCost on the K8s cluster reads it to price spot accurately.

---

## 2. Config knobs

Under the `core:` namespace.

| Key | Type | Default | Notes |
|---|---|---|---|
| `ssoProfile` | string | — | aws-sso profile name. Only read by the `p-run` wrapper, not the stack itself. |
| `networkV4` | bool \| CIDR | `true` | `true` → auto `10.{accountId[-2:]}.0.0/16`. `false` → no IPv4. String → custom CIDR. |
| `networkV6` | boolean | `true` | Dual-stack. |
| `forEksCluster` | boolean | `false` | Convenience switch. Implies `privateSubnets`, `withGithubOidc`, and adds the EKS CNI IPv6 policy. |
| `privateSubnets` | boolean | `false` (true via `forEksCluster`) | Private workload subnets + NAT. |
| `publicSubnets` | boolean | `true` | Public workload subnets + IGW. |
| `withGithubOidc` | boolean | `true` | GitHub Actions OIDC provider. |
| `enableDnsHostnames` | boolean | `true` | VPC DNS hostnames. Sometimes flipped off where EKS bootstrap required it. |
| `tags` | object | `{}` | Extra tags applied to everything, merged into the default set. |
| `domain` | string \| `false` | derived | Zone root. Derivation: `tamanu-internal` → `tamanu.app`, `tupaia-internal` → `tamanu.org`, `data-internal` → `data.bes.au`, `tamanu-{x}[-prod]` → `{x}.tamanu.app`, otherwise required. `domain: false` disables the zone. |
| `zoneImport` | string | — | Zone ID to import instead of creating. |
| `trailBucket` | string | `bes-{stack}-cloudtrail` | CloudTrail bucket name. |

---

## 3. What it exports

Consumed by downstream stacks via the `CrossStack` wrapper (see `docs/dev/pulumi-organisation.md`).

| Export | Purpose |
|---|---|
| `accountId`, `region` | Verified AWS context. `failIfIncorrectAccount()` reads these. |
| `tags` | Base tag set, merged into every downstream resource. |
| `network` | VPC ID, CIDRs, and all three subnet lists. `.subnetIds` convenience merges them. |
| `dbSubnetGroup` | RDS subnet group (present when `privateSubnets`). |
| `ipv4`, `ipv6` | Feature flags so downstream can branch (e.g. turn on dual-stack NLB listeners). |
| `zoneId`, `zoneName`, `zoneNS` | Route53 zone primitives. |
| `zoneMgmtPolicy` | Managed policy ARN to attach to cert-manager, external-dns, ACME users, etc. |
| `ghaOidc` | OIDC provider ARN + URL for GitHub Actions role trust. |
| `eksCniV6Policy` | IPv6 CNI policy ARN. Null when not EKS or not IPv6. |
| `spotDataFeed` | Bucket name + ARN for OpenCost. |

---

## 4. Real stack configs

One stack per AWS account; there are ~22 today.

**`Pulumi.tamanu-internal.yaml`** — the account that hosts the main EKS cluster:
```yaml
aws:region: ap-southeast-2
aws-native:region: ap-southeast-2
core:forEksCluster: true
core:ssoProfile: _Internal_Tamanu:AdminAccess
```
Domain derives to `tamanu.app`.

**`Pulumi.tamanu-example-prod.yaml`** — a production Linux-hosted customer account:
```yaml
core:domain: tamanu-example.org
core:ssoProfile: Example_Tamanu_Prod:AdminAccess
```
No `forEksCluster` — this account only has Linux servers (see `docs/spec/linux/server.md`). Public subnets and default DNS — nothing fancy.

**`Pulumi.data-internal.yaml`** — the data team's EKS account:
```yaml
core:forEksCluster: "true"
core:enableDnsHostnames: "false"
core:ssoProfile: _Internal_Data:AdminAccess
```
Domain `data.bes.au`. DNS hostnames flipped off — a one-off EKS bootstrap concession for this account.

**`Pulumi.tamanu-{x}-prod.yaml`** / **`Pulumi.tamanu-{x}-dev.yaml`** — the long tail is all similar shape: `domain`, `ssoProfile`, occasionally a custom `networkV4` CIDR.

---

## 5. `p-run`

`pulumi/core/p-run` is a small wrapper that reads `ssoProfile` from the stack you're about to work on, then runs your `pulumi` command under `aws-sso exec -p {profile} --`. Usage:

```sh
./p-run tamanu-internal preview
./p-run Pulumi.tamanu-example-prod.yaml up
```

It's the easy way to avoid having to remember per-account SSO profiles. The same wrapper pattern is used for other stacks that need AWS creds.

---

## 6. How downstream stacks reach in

Every workload stack points at its core via a single config key:

```yaml
# tamanu-on-linux
tamanu-on-linux:core: bes/core/tamanu-example-prod

# k8s-core
k8s-core:core: bes/core/tamanu-internal

# backups
tamanu-backups:core: bes/core/tamanu-internal
```

The stack then imports `common/coreRef.ts` (or `common/k8s/coreRef.ts` for K8s workloads) to get typed accessors to everything core exports, plus `failIfIncorrectAccount()` which bails out early if the AWS creds don't match the core's `accountId`.

See `docs/dev/pulumi-organisation.md` for the plumbing.

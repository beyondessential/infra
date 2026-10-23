# Pulumi Repo Organisation

How `pulumi/` is laid out, the conventions every stack follows, and the shared utilities in `common/`. For the `core` stack itself see `docs/dev/pulumi-core.md`; for the K8s clusters see `docs/spec/kubernetes/` and `docs/reference/k8s-what-lives-where.md`.

---

## 1. Layout

```
pulumi/
├── Pulumi.yaml only in subdirs — the repo root has no project
├── package.json          # single shared node_modules for all stacks
├── tsconfig.json
├── README.md             # install + usage quickstart
├── stacks → .            # symlink to self; lets you write `pulumi/stacks/foo`
│
├── common/               # shared utilities (see §4)
├── constants/            # hard-coded IDs, AMIs, public endpoints (see §5)
│
├── core/                 # foundational per-AWS-account stack (see docs/dev/pulumi-core.md)
├── primary/              # tiny stack for the primary billing account
│
├── k8s-core/             # EKS cluster per K8s cluster (see docs/reference/k8s-core-config.md)
├── k8s-essentials/       # cluster-wide services on top of k8s-core
│
├── tamanu/
│   ├── on-linux/         # Tamanu on EC2 (docs/spec/linux/)
│   ├── on-k8s/           # Tamanu on K8s (docs/reference/tamanu-deployment-config.md)
│   ├── k8s-infra/        # Tamanu-scoped cluster-wide infra
│   ├── dhis2/            # Tamanu DHIS2 server
│   ├── ips/, ips-infra/  # International Patient Summary
│   └── infra/, artifacts/
│
├── canopy/               # Canopy control plane (the Tamanu meta server)
├── canopy-infra/         # AWS-side IAM for the Canopy control plane (IRSA roles)
├── canopy-recovery-vault/ # compliance-locked Canopy secret recovery vault (write-only, separate account)
│
├── backups/              # Kopia backup infra
├── backups-shared/       # cross-account IAM for Canopy-provisioned shared backup buckets
├── backup-monitoring/
├── data/                 # data team workloads
├── drata/                # Drata compliance integration
├── policies/             # Pulumi policy packs
├── agent-slack/          # Slack bot
├── bestool-proxy/        # bestool update server
├── first-officer/        # on-call tooling
├── golinks/              # go/ short links
├── pollen/               # Pollen, guided technical walkthrough for new Tamanu deployments
├── security-monitoring/  # organisation-wide GuardDuty enablement and finding delivery to Slack
├── shared-amis/          # one-off setup for the account that publishes public shared AMIs
├── tailzero/             # Border0 tailzero connector, single-instance on K8s
├── ts-relay/             # Tailscale userspace relay
├── ts-relay-verify/      # disposable client box that proves the peer relay carries traffic
└── …
```

One `npm install` at `pulumi/` top level covers every stack — they all share dependencies. Each stack has its own `Pulumi.yaml` (project) and one or more `Pulumi.{name}.yaml` (stacks).

The `stacks` symlink is a compatibility shim, not a convention to reach for. Stacks used to live at `pulumi/stacks/…`; when they were flattened to `pulumi/…`, external consumers (CI configs, scripts) had hard-coded the old paths, so the symlink stays to keep those working. New code should use the flat paths directly.

---

## 2. Stack reference convention

Almost every stack starts with:

```ts
import { failIfIncorrectAccountOrRegion } from '../../common/coreRef.ts';
await failIfIncorrectAccountOrRegion();
```

or, for K8s workloads:

```ts
import { failIfIncorrectCluster } from '../../common/k8s/coreRef.ts';
await failIfIncorrectCluster();
```

Those guards exist to make it impossible to accidentally point a stack at the wrong AWS account or the wrong cluster. They read the `core` (or `k8s-core`) config key, pull `accountId`/cluster endpoint out of the referenced stack, and compare to what the current AWS or kubectl context actually resolves to. If they mismatch, the Pulumi run stops before any resource is touched.

Config key convention, always the same shape:

```yaml
# AWS-resource stacks
something:core: bes/core/{accountStackName}

# K8s workload stacks
something:k8s-core: bes/k8s-core/{clusterStackName}
```

---

## 3. How cross-stack references work

The glue is `common/CrossStack.ts`: a thin typed wrapper around Pulumi's `StackReference`. Two specialised entry points build on it:

- **`common/coreRef.ts`** — wraps `cfg.require('core')`. Exports `$core`, `$network`, `tags`, `ghaOidc`, `zone`, `region`, `coreStackName`, `stackName`, `pascalStackName`, and `failIfIncorrectAccountOrRegion()`. Re-exports `cfg`.
- **`common/k8s/coreRef.ts`** — wraps `cfg.require('k8s-core')`. Exports `$core`, `clusterName`, `clusterFullName`, `tags`, `version`, `backups`, `oidcProvider`, `region`, `$network` (the *underlying* core stack's network, reached transitively), and `failIfIncorrectCluster()`. Also re-exports `cfg`.
- **`common/primaryRef.ts`** — wraps `bes/primary/{region}` for the very small primary-account stack.

The `$core.name.split('/')[2]` trick derives the trailing part of a stack name (`bes/core/tamanu-internal` → `tamanu-internal`). That feeds `coreStackName`, and any current-stack name that starts with it is stripped (`tamanu-internal-main` → `main`). This is how downstream stacks get a compact name of their own position within a core — useful for tagging and resource naming.

`failIfIncorrectCluster()` has a nice extra trick: it recognises Tailscale MagicDNS kubeconfigs (`https://k8s-operator-{name}.tail{hex}.ts.net`) and matches on the cluster name embedded in the hostname, so you can run `k8s-essentials` pulumi over the Tailscale proxy without AWS creds — see "Over the tailnet" in `docs/sops/connect-to-k8s-cluster.md`.

---

## 4. `common/` — shared utilities

### Config / wiring

- **`cfg.ts`** — single shared `new Config()` instance. All utilities that need config read from this, which means downstream stacks don't instantiate their own.
- **`awsAccount.ts`** — `accountId`, `partition`, `dnsSuffix`, `region` pulled from `getCallerIdentity()`. The `region` here is awaited (a string), not an Output — important when you need synchronous branching.
- **`coreRef.ts`** / **`primaryRef.ts`** — described in §3.
- **`CrossStack.ts`** — the typed `StackReference` wrapper. Has specialised getters (`.network()`, `.tags()`, `.ghaOidc()`, `.zone()`, `.k8sCore()`, etc.) so you get types without having to remember output key names. `.network()` merges `natSubnets`, `workloadSubnets`, `publicWorkloadSubnets` into a convenience `subnetIds` list.

### Networking

- **`Network.ts`** — the ComponentResource core uses to lay out a VPC. NAT subnets are small /28s (not full /24 per AZ) to leave room for appliances; workload subnet indexing is offset so you can flip `publicSubnets` on/off without triggering a full recreation. Exports `NetworkOutputs` (that shape is what `$core.network()` returns). Helper `nthSubnetV4()` / `nthSubnetV6()` for sub-carving CIDRs.
- **`securityGroupRules.ts`** — pre-baked `all`, `allICMP`, `allICMPv4`, `allICMPv6`, `openPort(desc, port, proto)`, and `withNetwork(net).openVpcPort(…)` for VPC-CIDR-scoped rules.
- **`dns.ts`** — `truncateDomainIfNeeded(name, zone)` for Route53 63-char label limits.

### Compute / instances

- **`cloudInit.ts`** — composable cloud-init command builders: `hostnameCommands`, `tailscaleInstallCommands`, `tailscaleUpCommands`, `emergencySshKeyCommands`, `btrfsSwapFileCommands`, `cloudInitYaml` to wrap them as YAML. Used by `TailscaleBox` and `tamanu-on-linux`.
- **`TailscaleBox.ts`** — EC2 box that auto-joins Tailscale. Custom Ubuntu ARM64 AMI, IMDSv2, emergency SSH key. Short-lived (15 min) one-use auth key; the node itself is persistent.
- **`tailscaleKey.ts`** — creates a single-use, pre-authorised Tailscale auth key with configurable tags and expiry.
- **`instances.json`** + **`refreshInstances.sh`** — curated Vantage dump of current-gen EC2 instance types, filtered to Nitro + enhanced networking + IPv6 + EBS-optimised, with on-demand and spot prices per region. Refreshed manually with the script. Read by `common/k8s/instanceTypeGroups.ts` to pick instance types dynamically.

### DNS / LB / static sites

- **`ValidCertificate.ts`** — creates an ACM cert and validates it via Route53 in one go. Optional us-east-1 provider mode for CloudFront. Uses `deleteBeforeReplace: true` on validation records to survive updates.
- **`LoadBalancer.ts`** — ALB with an HTTP→HTTPS redirect and an HTTPS listener. Will auto-create a cert via `ValidCertificate`. Registers a Route53 alias.
- **`BucketWebsite.ts`** + **`bucket-website-request-function.js`** / **`bucket-website-response-function.js`** — S3 bucket + CloudFront distribution + CloudFront Functions for the request (rewrite `/path/` to `/path/index.html`, redirect bare paths) and response (charset, CORS that allows HEAD/OPTIONS but not GET, for anti-hotlinking). Supports importing existing buckets.

### IAM / secrets

- **`eksServiceAccount.ts`** — one-shot IRSA role with the OIDC trust policy built for you. Takes `namespace` and `serviceAccount` names, or wildcards via `StringLike` when you pass `system:serviceaccount:*:*` shapes.
- **`Secret.ts`** — Secrets Manager secret + version with `namePrefix` support. Returns `arn` and `versionId`.

### Code helpers

- **`RustLambda.ts`** — Rust on `provided.al2`, ARM64 by default. Expects `source/` with `Cargo.toml`, a `bootstrap` binary, and a `pack.sh` zip script. Runs `cargo lambda` through `local.Command` so a Pulumi preview/up also does the build. VPC + networking IAM wired if you pass VPC config.
- **`tags.ts`** — `nativeTags(...manyTags)` merges classic `{Key: Val}` maps into AWS-native `[{key, value}]` arrays; `nativeTitlecaseTags(...)` for the uppercase-`Key` variant; `classicTags(...)` for the reverse. Used everywhere because native and classic providers want different shapes.

---

## 5. `common/k8s/` — Kubernetes utilities

### Wiring

- **`coreRef.ts`** — described in §3.
- **`client.ts`** — `k8sConfig(kubeconfig?)` and `k8sClient(type, kubeconfig?)` for reaching the cluster API from Pulumi code. Underpins `waitFor.ts` and `postgresUrl.ts`.

### Scheduling

- **`affinities.ts`** — node-affinity match expression fragments: `RUN_ON_SPOT` (targets `bes.node.schedule=spot`), `archAffinity(arch)`, `purposeAffinity(purpose)`. Pair with…
- **`tolerations.ts`** — `CAN_RUN_ON_SPOT`, tolerating the `PreferNoSchedule` taint on spot nodes.
- **`instanceTypeGroups.ts`** — reads `instances.json` and exposes filters: `instancesForRegion`, `instancesSizedAtLeast`, `instancesSizedExactly`, `nonBurst`, `onlyBurst`, `sortByPrice`, `spotWithinOnDemandPrice`, `upToMonthly`, `isNitro`, `isK8sFamily`. Node groups in `k8s-core` pick instance types this way rather than hard-coding.

### Storage

- **`MountpointS3.ts`** — PersistentVolume + PersistentVolumeClaim via the AWS S3 CSI driver. Read-write or read-only, optional prefix, capacity is a dummy value (CSI driver ignores it).

### Postgres

- **`postgres.ts`** — `runPostgres()` creates a CloudNativePG `Cluster` with replicas, storage, timezone, roles, optional VolumeSnapshot-based backups, PostGIS option. `shared_buffers` is 25 % of memory request. Prefers spot via affinity but doesn't require it. Waits for the cluster to be ready via `k8sWaitFor` and returns the secret.
- **`postgresUrl.ts`** — `postgresUrlSecret()` reads the CNPG-created `{name}-db-app` / `{name}-db-superuser` secrets and publishes a derived secret containing DB URLs in every format you might want: plain password, libpq `dburl`, read-only `rodburl`, port-forward `localdburl`, JDBC, Rocket.rs. Null gracefully if the source secret doesn't exist yet.
- **`postgresCron.ts`** — CronJob that runs a psql command against the cluster. Auto-mounts `PGPASSWORD` from the secret above. Tiny default resources.
- **`dbRoleSecret.ts`** — K8s Secret with username + random (stable) password for use in the CNPG `managed.roles[].passwordSecret` slot. Labelled `cnpg.io/reload: true` so CNPG picks up rotations.

### Readiness / observability

- **`waitFor.ts`** — `k8sWaitFor(desc, waiter, arg, opts)`. Polls until the condition returns truthy, returns an Output that gates downstream resources. Bypassed in dry-run.
- **`annotations.ts`** — `metricsScrape(port=9090, path='/metrics', slow=false)` builds the standard Prometheus annotations.

### Gateway API

- **`gateway/`** — thin TypeScript builders for Gateway API resources (`Gateway`, `HTTPRoute`), plus `consts/` (versions, gateway class names, scopes) and `interfaces/` (TLS, listener, route types). Envoy Gateway is the implementation. Used pervasively in `tamanu/on-k8s`.

---

## 6. `constants/`

Two files, no code, just values.

- **`external.ts`** — things anyone could look up but that shouldn't be copy-pasted across stacks: AWS service principals (`AWS_STS`, `AWS_EC2`, `AWS_EKS`), GitHub Actions OIDC URL + thumbprints, convenience permission sets (`AWS_ECR_PULL`, `AWS_S3_READ`, `AWS_S3_MULTIPART`, etc.), and `alpineAmi(version, arch, userdata)` for finding official Alpine AMIs.
- **`internal.ts`** — our specifics: org/root IDs, the custom Ubuntu ARM64 AMI IDs per region (for `tamanu-on-linux`), the tailnet domain (`tail53aef.ts.net`), log bucket names, the emergency SSH public key, the default Postgres version, and the Envoy Gateway class name.

---

## 7. `primary/`

One-file stack per region (`Pulumi.ap-southeast-2.yaml`, `Pulumi.eu-central-2.yaml`). Lives in the primary AWS account (billing / org root). Currently the only thing `index.ts` does is account-guard + import `passwords.ts`. The point is more that there's a dedicated stack you can attach primary-account resources to over time — other stacks reach in via `common/primaryRef.ts` (wraps `bes/primary/{region}`).

---

## 8. Conventions worth knowing

**Names and regions.** Stack names carry meaning: `bes/{project}/{stackName}`. The `stackName` often encodes region or environment. `coreRef.ts` parses that to compute relative names — e.g. `k8s-core/tamanu-internal-main` under `bes/core/tamanu-internal` resolves its own name as `main`.

**Tags.** Every AWS resource gets the tag set from `$core.tags()`. Downstream stacks almost never define their own tag maps — they merge `tags` (classic) or `nativeTags` (native provider). If you need AWS's uppercase shape, `nativeTitlecaseTags()` does that.

**IPv6 is the default.** Both `k8s-core` and `core` stacks enable IPv6 by default; `tamanu-on-linux` tolerates it; the K8s cluster NLBs are IPv6-primary. IPv4 is still there but the wiring is all dual-stack.

**Ignore changes for drift you don't want.** Recurring pattern: `ignoreChanges: ['ami']` on instances (the AMI gets newer over time, you don't want to force-recreate), `ignoreChanges: ['version']` on EKS addons (upgrade deliberately, not on every apply), `ignoreChanges: ['users', 'roles', 'groups']` on `aws-native:iam:ManagedPolicy` (see AGENTS.md — CloudFormation otherwise fights us over attachments), `ignoreChanges` on SG rule collections so manual firewall edits survive.

**`protect: true` for things that must not be destroyed.** Backup buckets (`tamanu-on-linux` Kopia), the organisation CloudTrail Lake event store (`security-monitoring`), and similar "even a bad `pulumi destroy` shouldn't wipe these" resources set it. Paired with S3 object-lock where applicable.

**Secrets live in Pulumi config as `secret:` values or in AWS Secrets Manager via `common/Secret.ts`.** Never in code, never in plain YAML. Tailscale auth keys and API tokens use Secrets Manager. Short-lived cloud-init secrets (`tamanu-on-linux`) use Pulumi `secret()` at output time so they don't hit state files in plaintext.

**AWS creds via `aws-sso` and `p-run`.** Each stack that provisions AWS resources declares `ssoProfile` in its config. `core/p-run` wraps `pulumi` in `aws-sso exec -p {profile} --`. K8s workload stacks that only talk to the K8s API via Tailscale don't need AWS creds at all.

**`failIfIncorrectAccountOrRegion` / `failIfIncorrectCluster` run early.** Both are awaited at the top of the program, before any resource is declared, so a stack pointed at the wrong account, region or cluster fails its preview. `core` has the same guard for itself in `src/guard.ts`: `aws:region` must be set in the stack config and must match the region of the previous update.

**`CLAUDE.md` / `AGENTS.md` codify rules.** The repo-level `AGENTS.md` (loaded automatically into agent conversations) has hard constraints worth reading: an agent runs commands only with `[accountname]:ReadAccess` profiles through `aws-sso exec`, never with other access levels, and stops before any AdminAccess command and asks the user instead; previews are fine but never `pulumi up`; prefer scripts or Pulumi over manual per-account changes.

---

## 9. Quick map — when to reach for what

| You want to… | File |
|---|---|
| Guard against wrong AWS account | `common/coreRef.ts` → `failIfIncorrectAccountOrRegion()` |
| Guard against wrong K8s cluster | `common/k8s/coreRef.ts` → `failIfIncorrectCluster()` |
| Read the VPC | `common/coreRef.ts` → `$core.network()` or `$network` |
| New VPC | `common/Network.ts` (usually only core does this) |
| Route53 zone ops | `common/coreRef.ts` → `zone`; attach `$core.zoneMgmtPolicy` |
| HTTPS endpoint on an ALB | `common/LoadBalancer.ts` |
| Static site on S3+CloudFront | `common/BucketWebsite.ts` |
| Rust Lambda | `common/RustLambda.ts` |
| Tailscale-joined EC2 box | `common/TailscaleBox.ts` |
| Tailscale auth key | `common/tailscaleKey.ts` |
| Secrets Manager wrapper | `common/Secret.ts` |
| IRSA role | `common/eksServiceAccount.ts` |
| Tag conversion | `common/tags.ts` |
| Pick EC2 instance types | `common/k8s/instanceTypeGroups.ts` |
| Node affinity / tolerations | `common/k8s/affinities.ts` + `tolerations.ts` |
| CNPG cluster | `common/k8s/postgres.ts` |
| Postgres URL secret | `common/k8s/postgresUrl.ts` |
| Cron job hitting Postgres | `common/k8s/postgresCron.ts` |
| Poll until a K8s resource is ready | `common/k8s/waitFor.ts` |
| Prometheus scrape annotations | `common/k8s/annotations.ts` |
| Mount an S3 bucket in a pod | `common/k8s/MountpointS3.ts` |
| Gateway / HTTPRoute | `common/k8s/gateway/` |
| Centralised IDs / AMIs / keys | `constants/internal.ts`, `constants/external.ts` |

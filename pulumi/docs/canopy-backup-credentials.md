# Canopy backup-credentials — IaC implementation spec (ops/pulumi)

Status: implementation spec for the ops/pulumi side of Canopy's
backup-credentials system. The authoritative product/system design lives in
the `canopy` repo (`docs/plans/backup-credentials.md`); this file is the
concrete, ops-maintainer-facing contract for what changes in **this** repo
and what interfaces it exposes to / consumes from Canopy.

This spec is **stage 1**. The blind-relay hardening (stage 2) does not change
the IaC shape here other than eventually moving the STS-assume + Secret-read
rights off `public-server`; it is out of scope for this document.

## What Canopy is doing (one paragraph of context)

Canopy is becoming the control plane for kopia backups on the remote
server fleet. Devices no longer hold long-lived AWS keys; instead Canopy's
central-account pod (via IRSA) does a cross-account `sts:AssumeRole` on a
**per-group, per-bucket role** in the deployment account and hands the
resulting short-lived creds to the device over mTLS. Canopy also runs
repository **maintenance**, read-only **inspection**, and an **upstream
preflight** as Kubernetes Jobs, and (later) lends read-only creds to **PGRO**
for restore-verification. The bucket isolation boundary is one S3 bucket per
server-group. Object Lock (GOVERNANCE 30d) + versioning + lifecycle is the
destruction backstop; no device cred ever gets `s3:DeleteObject`.

Everything ops owns is: the **per-bucket roles and bucket config** (in the
deployment account, the `backups` / `tamanu/on-linux` stacks), the
**central-account ServiceAccount + IRSA** for Canopy's pods and Jobs (in the
`tamanu/meta` stack), and the **cross-account OIDC provider registration** in
each deployment account so the central cluster's Job web-identities can be
trusted there.

---

## Component A — per-bucket IAM in the deployment account (`backups/index.ts`)

Today `backups/index.ts` (and the structurally-identical `tamanu/on-linux`
`createOwnBucket()` in `src/backup/kopia.ts`) build, per stack:

- an S3 bucket with `objectLockEnabled`, versioning, GOVERNANCE-30d default
  retention, and a `DenyInsecureTransport` bucket policy;
- a `backups-fullaccess-*` managed policy + role (`s3:*`), today trusting
  `Principal: { Service: ec2.amazonaws.com }`;
- a `backups-kopia-*` managed policy + role (`AWS_S3_BACKUP_ACTIONS`), today
  trusting EC2;
- the `.storageconfig` object (`BucketObjectv2`, INTELLIGENT_TIERING for `p`
  blobs);
- optional IAM `User`s from the `users` config (`backupUsers` export).

These are the EC2-resident model (a server assumes its role directly). The
canopy fleet is remote / mTLS / not EC2 in our account, so it can't assume an
AWS role directly — Canopy assumes the role cross-account and hands creds out.
The changes below add the Canopy path **without removing** the EC2 path or the
IAM-User path (both must be preserved so existing direct-S3 consumers keep
working during/after migration).

### A1. Trust Canopy's principals (not only EC2)

The roles Canopy or its Jobs assume need their `assumeRolePolicyDocument`
extended with **cross-account** trust statements alongside the existing EC2
service principal. This is cross-account: Canopy's IRSA role and the Job IRSA
roles live in the **central account** (where `tamanu/meta` deploys), while
this stack runs in the **deployment account**.

Two trust mechanisms are in play and they are different:

1. **`public-server`'s issuer role** assumes the per-bucket roles via a
   *chained* `sts:AssumeRole` from its own IRSA session. So the per-bucket
   role must trust the **central-account issuer role ARN** as an AWS
   principal:

   ```ts
   { Effect: 'Allow', Action: 'sts:AssumeRole',
     Principal: { AWS: canopyIssuerRoleArn } }
   ```

2. **Maintenance / inspection / PGRO Jobs** authenticate with a *direct*
   web-identity (`sts:AssumeRoleWithWebIdentity`) against the **central
   cluster's OIDC provider, registered in this deployment account** (see
   Component C). So those roles trust the `Federated` OIDC provider ARN with a
   `sub` condition pinning the central-cluster ServiceAccount(s):

   ```ts
   { Effect: 'Allow', Action: 'sts:AssumeRoleWithWebIdentity',
     Principal: { Federated: deploymentAccountOidcProviderArn },
     Condition: { StringEquals: {
       [`${oidcId}:aud`]: 'sts.amazonaws.com',
       [`${oidcId}:sub`]: 'system:serviceaccount:<canopy-ns>:<canopy-jobs-sa>',
     } } }
   ```

   The `<canopy-ns>` is Canopy's namespace in the central cluster
   (`tamanu-meta-<stack>`), **not** anything in the deployment cluster. This
   is the one genuinely fiddly cross-cluster/cross-account knot: the OIDC
   issuer is the *central* cluster, but the provider object and the role are
   in the *deployment* account.

The mapping of which principal trusts which role:

| Role (deployment acct)                 | Trusts (central acct)                              | Mechanism                          |
|----------------------------------------|----------------------------------------------------|------------------------------------|
| per-bucket **device/issuer role** (kopia role, reduced) | `public-server` issuer IRSA role ARN     | chained `AssumeRole`               |
| per-bucket **maintenance role** (fullaccess role) | maintenance/inspection Job SA via OIDC          | direct `AssumeRoleWithWebIdentity` |
| per-bucket **maintenance role** (or a RO sibling) | PGRO Job SA via OIDC (later stage)              | direct `AssumeRoleWithWebIdentity` |

**Hard requirement (from the threat model): the maintenance / fullaccess role
trust must NEVER include the `public-server` issuer principal.** Delete +
`BypassGovernanceRetention` stay reachable only from the Job web-identity
path, so a `public-server` compromise cannot reach the delete capability.
Keep the issuer-role trust on the *reduced* role only.

These trust principals are **inputs** the stack reads from config (the central
account isn't known to this stack except via config), e.g.:

```yaml
config:
  backups:canopyIssuerRoleArn: arn:aws:iam::<central>:role/<canopy-issuer>
  backups:canopyOidcProviderArn: arn:aws:iam::<deployment>:oidc-provider/oidc.eks...
  backups:canopyJobsServiceAccount: system:serviceaccount:tamanu-meta-<stack>:canopy-jobs
```

When `canopyIssuerRoleArn` is unset, fall back to EC2-only trust (so existing
stacks are unaffected until onboarded). Use `ignoreChanges`-safe construction;
do not clobber the existing EC2 statement.

### A2. Reduce the device-backup action set to `AWS_S3_MULTIPART_ACTIONS`

The role Canopy assumes for **device** creds (the existing `backups-kopia-*`
role) must drop delete. Today the kopia policy uses `AWS_S3_BACKUP_ACTIONS`
(`constants/external.ts:52`) which is
`[...AWS_S3_DELETE_ACTIONS, 's3:PutObjectRetention']` — it includes
`s3:DeleteObject` and `s3:PutObjectRetention` because the EC2 server ran its
own maintenance. Under the Canopy model the device must **not** delete and
does **not** set retention (the bucket's default retention auto-locks every
PUT). So the device role's managed policy must use the existing
**`AWS_S3_MULTIPART_ACTIONS`** constant directly (Get/Put + multipart +
ListBucket/GetBucketLocation, no `DeleteObject`, no `PutObjectRetention`).

Do **not** invent a new constant — `AWS_S3_MULTIPART_ACTIONS` already exists
and is the agreed source of truth for the device set. The `backup` permission
template in the Canopy plan is illustrative; this constant is normative.

Keep `AWS_S3_BACKUP_ACTIONS` (full delete set) on the **maintenance /
fullaccess** role only. The full set is the only identity that may delete.

`s3:PutObjectRetention` drop note (H3 in the plan): the GOVERNANCE default
retention on the bucket auto-locks every PUT, so the device needs no
permission to set retention. **Verify** kopia's S3 backend writes/maintains
fine against a default-retention bucket with no client-side
`PutObjectRetention` (it deletes by key → markers, doesn't set per-object
retention). Fallback if kopia insists: re-grant `s3:PutObjectRetention` to the
device set — safe under GOVERNANCE-without-bypass (can only lengthen a lock).
This verification is a kopia-behaviour check, flagged as an open question
below; the IaC default is to omit it.

### A3. Add `s3:GetBucketObjectLockConfiguration` to the per-bucket (device) role

The per-group preflight reads the Object Lock config to confirm it's still in
place. No existing action set includes
`s3:GetBucketObjectLockConfiguration`, so without adding it the day-one
preflight gets `AccessDenied`. Add it (bucket-level resource
`arn:aws:s3:::<bucket>`) to the role Canopy assumes for the preflight — the
device/issuer role is the natural home since the preflight uses the same
issuance path. It's read-only and harmless on the device set.

### A4. Export the role ARNs

The stack currently exports `roleForFullAccess` / `roleForKopia` as role
**names**. Canopy config (`server_group_backup_config.target_role_arn`) needs
the **ARN**, and the maintenance Job IRSA needs the fullaccess role ARN. Add:

```ts
export const deviceRoleArn = kopiaRole.roleArn;          // → target_role_arn
export const maintenanceRoleArn = fullAccessRole.roleArn; // → Job IRSA target
export const bucketArn = bucket.arn;                      // convenience
```

(`awsNative.iam.Role` exposes `.arn`.) Keep the existing name exports for
backwards compatibility. In `tamanu/on-linux`'s `kopia.ts`, mirror these in
the `KopiaOutputs` interface and the `cloneFromStack` re-export path, so a
clone stack re-exports the parent's role ARNs (consistent with how it already
re-exports `backupBucket` / `backupUsers`).

### A5. Preserve IAM-Users and `.storageconfig`

The `backupUsers` IAM-User path (`backups/index.ts:162-172`) and the
`.storageconfig` `BucketObjectv2` must be left intact. They are not part of
the Canopy path but existing direct consumers rely on them, and the
`.storageconfig` object carries `ignoreChanges: ['objectLockMode',
'objectLockRetainUntilDate']` (because the bucket auto-locks it) — preserve
that exactly. Do not let the trust-policy edits trigger a replace of the
policies that the users are attached to; keep the
`ignoreChanges: ['users', 'roles', 'groups']` on the managed policies.

### A6. Lifecycle rules on the standalone `backups` stack

The standalone `backups` stack has **no** `lifecycleConfiguration` today; the
`tamanu/on-linux` `kopia.ts` already does (lines 59-72). On a versioned +
object-locked bucket, kopia "deletes" are delete-markers and reclaim nothing
until lifecycle expires the noncurrent versions — so the lifecycle rule is
**load-bearing for normal GC**, not optional. Add to the `backups` bucket,
matching `on-linux`:

```ts
lifecycleConfiguration: {
  rules: [{
    id: 'expire-noncurrent-and-incomplete',
    status: 'Enabled',
    noncurrentVersionExpiration: { noncurrentDays: 35 },  // ≥ the 30-day lock
    abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
  }],
},
```

`noncurrentDays: 35` (≥ the 30-day GOVERNANCE window). This also defines the
poisoning-recovery deadline: good noncurrent versions survive until lifecycle
reclaims them (~30-35 days). The bucket is `protect: true`, so adding
`lifecycleConfiguration` is an in-place update, not a replace — confirm in the
preview diff that it doesn't force replacement.

---

## Component B — central-account ServiceAccount + IRSA + RBAC (`tamanu/meta`)

Canopy's pods carry **no** ServiceAccount today — the shared `spec.ts`
(`tamanu/meta/src/spec.ts`) injects only env/affinity/tolerations/resources,
and `common/eksServiceAccount.ts` exists but is unused by canopy. This
component is net-new wiring in the `tamanu/meta` stack (the central account /
central cluster).

### B1. Two IRSA roles + two ServiceAccounts

Create **two** identities, because they have different blast radii and the
threat model requires the delete capability to be unreachable from the
internet-facing pod:

1. **`canopy-issuer`** — used by `public-server` (and `private-server` if it
   needs Secret-read for the operator UI). Trusted by **per-bucket device
   roles** in deployment accounts (chained assume) and granted Kubernetes RBAC
   to **`get` Secrets** (repo passwords) in Canopy's namespace. It must
   **not** be trusted by any maintenance/fullaccess role.

2. **`canopy-jobs`** — used by the single **`backups`** scheduler pod (which
   runs the preflight / maintenance / inspection / s3-metrics loops in one
   process) and the per-group Jobs it spawns. Trusted by **per-bucket
   maintenance roles** in deployment accounts (direct web-identity) and granted
   Kubernetes RBAC to **create/list/delete Jobs**, **`get pods`** (read the
   completion result from the pod termination message), and **`get` Secrets**.
   The s3-metrics loop does **not** need cross-account CloudWatch on this SA —
   it **assumes the group's per-bucket role** and reads CloudWatch with those
   creds (see below). So there is no separate metrics SA and no CloudWatch
   permission on `canopy-jobs` itself.

Use the existing helper:

```ts
import { eksServiceAccount } from '../../../common/eksServiceAccount.ts';
import { oidcProvider } from '../../../common/k8s/coreRef.ts'; // central cluster OIDC ARN

const canopyIssuerRole = eksServiceAccount('canopy-issuer', {
  serviceAccountName: 'canopy-issuer',
  oidcProviderArn: oidcProvider,
  namespace,                       // tamanu/meta/src/namespace.ts
  // no AWS managed policies needed: it only *assumes* per-bucket roles cross-account,
  // which is governed by the per-bucket role trust, not a policy here. (sts:AssumeRole
  // on a resource the caller is trusted by needs no extra identity policy.)
});

const canopyJobsRole = eksServiceAccount('canopy-jobs', {
  serviceAccountName: 'canopy-jobs',
  oidcProviderArn: oidcProvider,
  namespace,
});
```

Then create the matching k8s `ServiceAccount`s annotated with the IRSA role
ARN (`eks.amazonaws.com/role-arn`), in Canopy's namespace:

```ts
new k8s.core.v1.ServiceAccount('canopy-issuer', {
  metadata: {
    name: 'canopy-issuer',
    namespace,
    annotations: { 'eks.amazonaws.com/role-arn': canopyIssuerRole.arn },
  },
});
// likewise canopy-jobs
```

Export both role ARNs so deployment-account `backups` stacks can consume them
(via `CrossStack` or by config copy):

```ts
export const canopyIssuerRoleArn = canopyIssuerRole.arn;
export const canopyJobsRoleArn = canopyJobsRole.arn;
```

These are the **contracts Component A consumes** (`canopyIssuerRoleArn`,
`canopyJobsRoleArn`, and the central cluster OIDC `sub` for the jobs SA).

### B2. RBAC (namespace-scoped Roles + RoleBindings)

Follow the namespace-scoped pattern already used in
`tamanu/on-k8s/src/schedule.ts` and `gha-canopy.ts` (no ClusterRole where a
namespaced Role suffices, so the gha deploy role can manage it).

`canopy-issuer` — read repo-password Secrets only:

```ts
new k8s.rbac.v1.Role('canopy-issuer', {
  metadata: { namespace },
  rules: [{ apiGroups: [''], resources: ['secrets'], verbs: ['get'] }],
});
```

`canopy-jobs` — create/manage Jobs + read Secrets:

```ts
new k8s.rbac.v1.Role('canopy-jobs', {
  metadata: { namespace },
  rules: [
    { apiGroups: ['batch'], resources: ['jobs'], verbs: ['create', 'get', 'list', 'watch', 'delete'] },
    { apiGroups: [''], resources: ['secrets'], verbs: ['get'] },
    { apiGroups: [''], resources: ['pods', 'pods/log'], verbs: ['get', 'list', 'watch'] }, // read Job pod status/logs
  ],
});
```

Bind each Role to its ServiceAccount with a `RoleBinding`. Scope decisions
(narrow vs. broad verb list, whether `secrets` should be name-restricted via a
`resourceNames`) are flagged as open questions.

`delete` on Jobs lets the scheduler clean up finished Jobs (or rely on
`ttlSecondsAfterFinished` on the Job spec, as `schedule.ts` does, and drop
`delete`). Prefer `ttlSecondsAfterFinished` + drop `delete` if the scheduler
doesn't need imperative cleanup — decide at implementation.

### B3. Wire the ServiceAccount through `spec.ts`

`spec()` (`tamanu/meta/src/spec.ts`) returns a `PodSpec` and is shared by
`public-server`, `private-server`, and the job loops in `jobs.ts`. It needs an
optional `serviceAccountName` so callers can opt in:

```ts
export function spec(
  name: string,
  command: string[] = [],
  containerArgs: Partial<k8s.types.input.core.v1.Container> = {},
  podArgs: { serviceAccountName?: Input<string> } = {},  // new
): k8s.types.input.core.v1.PodSpec {
  return {
    ...containerArgs,
    ...(podArgs.serviceAccountName ? { serviceAccountName: podArgs.serviceAccountName } : {}),
    tolerations: [CAN_RUN_ON_SPOT],
    affinity: { /* unchanged */ },
    containers: [ /* unchanged */ ],
  };
}
```

(Keep the change additive: existing callers pass no `podArgs` and get no SA,
exactly as today.) Then:

- `public-server` Deployment (`servers.ts`) → `serviceAccountName: 'canopy-issuer'`.
- `private-server` Deployment → `serviceAccountName: 'canopy-issuer'` **iff**
  the operator UI serves Secret-backed data from private-server (it gates the
  Secret-read RBAC). Confirm against the Canopy side; default to issuer SA if
  unsure (private-server is Tailscale-gated, lower exposure than public).
- the new `backups` scheduler Deployment (B4) → `serviceAccountName:
  'canopy-jobs'`.

Note: `spec.ts` sets the container `args` to `command`; for the new `backups`
scheduler this is just the binary name (`['backups']`), exactly like the
existing `['monitor']` (the `reachability` bin, renamed — see B4).

### B4. One new scheduler Deployment in `jobs.ts` (+ rename `reachability` → `monitor`)

The Canopy plan adds a single new scheduler binary, **`backups`**
(`crates/jobs/src/bin/backups.rs`), that runs all four backup control-plane
loops as concurrent tasks in one process (following the `reachability` /
`pingtask` template). It needs **one** single-replica Deployment in
`tamanu/meta/src/jobs.ts`, mirroring the existing reachability block but with
`serviceAccountName: 'canopy-jobs'` plumbed via `spec()`'s new `podArgs`.

The four loops the `backups` pod runs:

- **preflight** — upstream preflight (shared `GetCallerIdentity` ~minute;
  per-group deep checks hourly, hash-jittered). AWS-touching (STS/S3).
- **maintenance** — spawns per-group maintenance Jobs (assert-retention →
  `kopia snapshot expire` → `kopia maintenance run`), quick-daily / full-weekly,
  hash-jittered.
- **inspection** — spawns per-group read-only inspection Jobs (`kopia snapshot
  list` + verify), writing `backup_repo_snapshots` / `backup_repo_stats`.
- **s3-metrics** — reads CloudWatch `BucketSizeBytes` per group (the billing
  basis). AWS-touching (CloudWatch).

These were originally specced as four separate bins/Deployments; Canopy
consolidated them into one bin/pod. They already shared the `canopy-jobs` SA,
so per-pod isolation was nominal — the real isolation is the per-Job kopia
roles, which stay separate. One pod ⇒ one Deployment to declare here.

**Staleness folds into `monitor`, not its own pod.** The staleness +
report-vs-inventory reconciliation sweep is DB-only and minute-cadence, so it
rides the existing reachability loop. That loop now runs reachability + tailnet
key-expiry + backup-staleness, so the Canopy bin was **renamed `reachability` →
`monitor`**. When landing this, **rename the existing reachability Deployment's
command (and name) to `monitor`** (`['monitor']`). No new Deployment for
staleness.

The `backups` Deployment follows the exact reachability shape (replicas 1,
strategy Recreate, `labels(name)`, `{ ...labels(name), ...costLabels }` on the
pod template, `dependsOn: [migrator]`), differing only by `spec('backups',
['backups'], {}, { serviceAccountName: 'canopy-jobs' })`.

The **per-group Jobs** themselves are spawned at runtime by the Canopy
scheduler via the k8s API (using the `canopy-jobs` SA), **not** declared in
Pulumi. Pulumi declares the *scheduler* Deployments and the SA/RBAC/IRSA they
use; the Jobs are dynamic. The Canopy plan owns the Job pod template
(image = kopia image, `secretKeyRef` mount of the repo password, billing.*
labels, the `canopy-jobs` SA reference for direct web-identity).

### B5. `billing.*` labels on spawned Jobs (contract, not Pulumi resource)

The plan requires spawned Jobs to carry `billing.product` / `billing.stage` /
`billing.deployment` pod labels for AWS split-cost allocation. Pulumi already
emits these via `billingTags()` (`common/billing.ts`) as `costLabels` in
`tamanu/meta/src/config.ts` (`product: 'tamanu'`, `stage`, `deployment`), and
puts them on every Deployment pod template. **Canopy must produce the same
label keys** on the Jobs it spawns. The contract:

- keys are exactly `billing.product`, `billing.stage`, `billing.deployment`
  (matching `billingTags()` output);
- `stage` values must match the existing CUR tags ops emits — note
  `ServerRank::Production` → `"prod"` (not `"production"`); Canopy maps
  explicitly (`Production→prod`, `Demo→demo`, …) and picks a fallback for
  all-unranked groups. This is Canopy-side logic; ops only owns the label-key
  convention and the existing `costLabels` on its own Deployments. No Pulumi
  resource captures the dynamic Job labels — they're set by Canopy at Job
  creation. This section is the *contract* so the two stay aligned.

---

## Component C — central-cluster OIDC provider in each deployment account

The maintenance/inspection/PGRO Jobs use **direct** `AssumeRoleWithWebIdentity`
against the **central cluster's** OIDC issuer. For a deployment-account role to
trust that issuer, the deployment account must have an **IAM OIDC provider**
registered for the central cluster's OIDC issuer URL (an account can only
federate an issuer it has a provider object for).

Pattern (mirrors `core/src/oidc.ts`, which registers the GitHub Actions OIDC
provider):

```ts
import * as awsClassic from '@pulumi/aws';
import { AWS_STS } from '../constants/external.ts';

const canopyClusterOidc = new awsClassic.iam.OpenIdConnectProvider('canopy-cluster', {
  url: centralClusterOidcUrl,        // from config; the issuer of the central EKS cluster
  clientIdLists: [AWS_STS],
  // thumbprintLists: modern EKS OIDC needs none / is managed; confirm provider behaviour
});
export const canopyClusterOidcProviderArn = canopyClusterOidc.arn;
```

This goes in the **deployment-account** stack (the `backups` stack, or a small
sibling stack stood up once per deployment account). The provider's ARN is
then what Component A's maintenance-role trust uses as `Principal: { Federated:
... }`, and the `sub` condition pins
`system:serviceaccount:<canopy-ns>:canopy-jobs` from the **central** cluster.

Inputs from config:
- `centralClusterOidcUrl` — the central EKS cluster's OIDC issuer URL (export
  it from `tamanu/meta` / `k8s-core` so it can be carried across).

Subtlety: shared-account deployments (several groups co-tenant) register the
provider **once** per account, not per bucket — it's account-scoped. The
per-bucket *roles* are still per group; only the OIDC provider object is
shared within an account. Make the provider registration idempotent / guarded
so co-tenant `backups` stacks don't each try to create it (e.g. register it in
a single per-account stack and `CrossStack`-import the ARN, rather than in each
`backups` stack). **Flag**: decide where this lives so two `backups` stacks in
one account don't collide on the provider — see open questions.

---

## Interfaces / contracts

### Exposed by ops → consumed by Canopy

- **`server_group_backup_config.target_role_arn`** = the per-bucket
  **device/issuer role ARN** (`backups` export `deviceRoleArn`). Canopy's
  `public-server` chained-assumes this for device creds; it has
  `AWS_S3_MULTIPART_ACTIONS` + `s3:GetBucketObjectLockConfiguration`, no
  delete.
- **maintenance role ARN** (`backups` export `maintenanceRoleArn`) = the
  `s3:*` fullaccess role; the `canopy-jobs` IRSA web-identity assumes it
  directly (no 1-hour chain cap) for maintenance/inspection/init Jobs.
- **`server_group_backup_config.bucket`** / `region` = the bucket name and
  region the stack provisions (`backups` exports `bucketName`, region from the
  stack's account).
- The **bucket guarantees** Canopy's preflight verifies: Object Lock
  GOVERNANCE ≥30d, versioning enabled, lifecycle present. Set at creation;
  cannot be retrofitted (so onboarding = apply stack, then insert config row).

### Exposed by Canopy → consumed by ops (config inputs)

- **`canopyIssuerRoleArn`** (central) — trusted by per-bucket device roles.
- **`canopyJobsRoleArn`** + the **`canopy-jobs` ServiceAccount `sub`**
  (`system:serviceaccount:<canopy-ns>:canopy-jobs`) — trusted by per-bucket
  maintenance roles via web-identity.
- **central cluster OIDC issuer URL** — for the Component C provider.
- **`billing.{product,stage,deployment}`** label keys — Canopy stamps them on
  spawned Jobs; ops owns the convention + its own `costLabels`.

### Consumed by ops from existing ops infra

- `common/eksServiceAccount.ts` — IRSA role + trust helper (central cluster).
- `common/k8s/coreRef.ts` `oidcProvider` — the **central** cluster OIDC ARN
  (for B1's IRSA).
- `common/billing.ts` `billingTags` / `config.ts` `costLabels` — billing tags.
- `constants/external.ts` `AWS_S3_MULTIPART_ACTIONS` (device set),
  `AWS_S3_BACKUP_ACTIONS` (maintenance set), `AWS_STS`.
- `common/CrossStack.ts` — to carry exports across stacks/accounts.

---

## Data shapes (config the new resources read)

Deployment-account `backups` stack config additions:

```yaml
config:
  backups:canopyIssuerRoleArn:      arn:aws:iam::<central>:role/<canopy-issuer>     # A1 mechanism 1
  backups:canopyJobsServiceAccount: system:serviceaccount:tamanu-meta-<stack>:canopy-jobs  # A1 mechanism 2 sub
  backups:centralClusterOidcUrl:    https://oidc.eks.<region>.amazonaws.com/id/<id> # Component C
  # optional: backups:bucketName override (existing); backups:users (existing); backups:tags (existing)
```

Central `tamanu/meta` stack: no new required config; the SA names
(`canopy-issuer`, `canopy-jobs`) and namespace come from the existing
`config.ts` / `namespace.ts`. New **exports**: `canopyIssuerRoleArn`,
`canopyJobsRoleArn` (and the cluster OIDC URL if not already exported by
`k8s-core`).

---

## Testing / verification approach (ops/pulumi conventions)

ops/pulumi has no unit-test harness for stacks; verification is
`pulumi preview` diffs + targeted manual checks. Per the repo's conventions:

1. **`pulumi preview` on a throwaway / dev stack** (`backups:nauru-dev` or a
   fresh test stack) for every change. Confirm:
   - the lifecycle-rule addition and the trust-policy edits are **in-place
     updates**, not replacements (the bucket and roles are `protect: true` /
     long-lived; a replace would be a regression). Object Lock + versioning
     cannot be retrofitted, so a bucket replace is catastrophic — assert no
     replace on the bucket.
   - the `.storageconfig` object and IAM Users are unchanged (no diff).
2. **Trust-policy correctness** — after apply on a dev stack, verify the
   chained assume works end-to-end: from a pod using `canopy-issuer` IRSA, do
   `aws sts assume-role --role-arn <deviceRoleArn>` and a read-only S3 no-op;
   and from the `canopy-jobs` web-identity, assume the maintenance role and do
   a delete-capable no-op (e.g. `s3api list-object-versions`). These mirror the
   Canopy preflight's behavioural checks — prefer behavioural verification over
   IAM introspection.
3. **Negative check (threat model):** confirm the **maintenance/fullaccess
   role does NOT trust** `canopy-issuer` — attempting to assume the
   maintenance role from the issuer principal must fail. This is the load-
   bearing isolation property; test it explicitly.
4. **OIDC provider** — confirm the deployment-account provider's issuer URL +
   thumbprint match the central cluster, and that a `canopy-jobs`
   web-identity token is accepted (the assume in step 2 covers this).
5. **`failIfIncorrectAccount()`** already guards the `backups` stack from being
   applied against the wrong account; keep it. The OIDC-provider stack
   (Component C) should have the same guard.
6. Run the repo's lint/format (`prettier` / `tsc` per the repo's existing
   tooling) on the changed `.ts` files before committing.

There is no Playwright/cargo equivalent here; the UI + Rust tests live on the
Canopy side. ops verification is preview-diff + the cross-account assume
smoke-checks above.

---

## Open questions / decisions to make

1. **Where does the central-cluster OIDC provider (Component C) live per
   deployment account?** Registering it inside each `backups` stack collides
   when two groups co-tenant one account (provider is account-scoped, roles
   are per-bucket). Options: a single per-account stack that exports the
   provider ARN (cleaner, but new stack to stand up per account), or guard the
   `backups` stack to create-once + `CrossStack`-import otherwise. Recommend
   the per-account stack. **Decide before onboarding the first shared
   account.**
2. **Does `private-server` need the `canopy-issuer` SA / Secret-read RBAC?**
   Depends on whether the operator UI (onboarding, escrow reveal, stats) reads
   repo-password Secrets from private-server or proxies through public-server.
   Confirm against the Canopy private-server implementation.
3. **Job cleanup: `ttlSecondsAfterFinished` vs. RBAC `delete` on Jobs.** Prefer
   TTL (as `schedule.ts` does) and drop `delete` from `canopy-jobs` RBAC if the
   scheduler doesn't need imperative deletion. Confirm with the scheduler
   design.
4. **Should Secret-read RBAC be name-restricted (`resourceNames`)?** Repo
   passwords are per-group Secrets with names from `repo_password_ref`; the
   names are dynamic, so a blanket `get secrets` in the namespace is the
   pragmatic choice, but it widens blast radius (esp. on `canopy-issuer`, the
   internet-facing pod's identity). Weigh a naming convention
   (`canopy-repo-pw-*`) + admission/OPA restriction, or accept the namespace
   scope (stage-1 accepted risk, closed by the blind-relay stage-2). Recommend
   accept-for-now, document the blast radius.
5. **kopia + default-retention without `PutObjectRetention` (A2 verify).**
   Confirm kopia writes/maintains against a GOVERNANCE-default-retention bucket
   with the device set lacking `s3:PutObjectRetention`. If kopia insists,
   re-grant it (safe under no-bypass). This gates whether A2's reduced set is
   exactly `AWS_S3_MULTIPART_ACTIONS` or that plus `s3:PutObjectRetention`.
6. **Carrying central-account values into deployment-account stacks** —
   `CrossStack` import vs. plain config copy for `canopyIssuerRoleArn` /
   `canopyJobsRoleArn` / OIDC URL. `CrossStack` is cleaner but couples stack
   refs across accounts; config copy is simpler and is what the existing
   per-stack `Pulumi.<stack>.yaml` pattern would suggest. Decide per the
   onboarding runbook.
7. **PGRO (later stage)** — PGRO runs in a *different* cluster, so its Job
   web-identity needs *its* cluster's OIDC provider registered in the
   deployment account too (a second Component-C provider), plus an
   external-restore-grant role trusting PGRO's SA, read-only. Out of scope for
   stage 1; noted so the per-bucket role design leaves room.

---

## Backup types — note

The "backup types" dimension (added to the Canopy plan after this spec) is
**above the IaC layer and requires no ops changes**: types are scheduled
and tracked by Canopy and tagged inside the kopia repo, but the bucket,
per-bucket roles, lifecycle, and IRSA are all per-*group* (one repo serves
all of a group's types). Nothing here keys on type. (If per-type cost
attribution is ever wanted, that'd be a future CloudWatch/inventory
concern, not a change to these roles/buckets.)

---

## Implementation-frozen contract (from canopy, 2026-06-16)

These were loose or "decide later" in the spec above; the canopy
implementation (PRs #224–#227) froze them. They are what the ops-built kopia
image entrypoint and the scheduler Deployments must match.

### Kopia Job image + entrypoint contract (env vars, not CLI args)

The image now **exists in-repo** at canopy `images/kopia-job/` (Dockerfile +
`entrypoint.sh` + `CONTRACT.md` + README), built/worked against there for now;
it is to be **moved to `~/code/work/third-party-builds`** and built/published
by ops. `CONTRACT.md` is the authoritative canopy⇄image contract.

The scheduler passes config to the container as **environment variables** (the
earlier draft used CLI args; switched to env to match the image + the password
mechanism):

- `KIND` — one of `maint-quick` | `maint-full` | `inspect` | `init`.
- `BUCKET`, `PREFIX`, `REGION`, `TARGET_ROLE_ARN` — repo location + the
  per-bucket role the entrypoint assumes via the pod's IRSA web-identity.
- `RETENTION_JSON` — a `{type → keep-policy}` **map** (per-`(group,type)`
  effective retention, org-floor-enforced by canopy), set for `maint-*`/`init`,
  **omitted for `inspect`**. `maint-*` applies each type's policy **per source**
  (`canopy@<server-id>:<type>`); `init` sets a strictest-of-map global baseline.
- `KOPIA_PASSWORD` — env via `secretKeyRef` (never an arg, never a plain-value
  env).
- The `backup_maintenance_runs` row id is carried on the Job's
  **`canopy-run-id` label** (maint only), not passed to the image.
- Source-host convention inside the repo is `canopy@<server-id>` with snapshot
  tags `canopy-device` / `canopy-run` / `canopy-type` (shared with bestool).

**Results return via the pod termination message.** The entrypoint writes a
single-line JSON result to `/dev/termination-log`; the Job manifest sets
`terminationMessagePolicy: File`. The scheduler reads
`pod.status.containerStatuses[0].state.terminated.message` and parses it —
`init`: `{ok,error}`; `maint-*`: `{ok,bytes_reclaimed}`; `inspect`:
`{ok,verify_ok,snapshot/source counts,logical/physical bytes,sources[]}`.
Schema: `images/kopia-job/CONTRACT.md`. RBAC consequence: the scheduler SA
needs **`pods` get/list** (to read the termination message) on top of Jobs
create/list/delete + Secrets get.

### Job manifest fields canopy sets (so RBAC + image + GC align)

- Labels on the Job **and** pod template: `canopy-group=<uuid>`,
  `canopy-backup-kind=<kind>`, and (maint only) `canopy-run-id=<id>`, plus
  `billing.{product,deployment,stage}` (B5).
- `metadata.generateName = canopy-backup-<kind>-<group-short>-`.
- `spec.backoffLimit = 2`, `spec.ttlSecondsAfterFinished = 3600`,
  `restartPolicy: Never`, **`terminationMessagePolicy: File`** (so results land
  in the pod termination message), per-kind `serviceAccountName` (maintenance
  SA for `maint-*`/`init`, inspection SA for `inspect`).

### Completion is poll-list + termination-message, not a report endpoint (resolves open-Q on the signal)

The scheduler **lists** Jobs by the `canopy-backup-kind` label each tick, reads
`status.succeeded`/`status.failed`, reads the pod's termination message for the
result payload, then deletes the Job. **No internal maintenance-report endpoint
is needed.** By kind: `maint-*` maps to the `backup_maintenance_runs` row via
the `canopy-run-id` label and records outcome + `bytes_reclaimed`; `inspect`
writes the ground-truth `backup_repo_snapshots`/`backup_repo_stats` and raises
the `backup-corruption` alert on `verify_ok:false`; `init` advances the config
`provisioning→escrow_pending`/`→ready` (or records `last_init_error`). RBAC for
the scheduler SA must therefore include Jobs **create/list/delete**, **`pods`
get/list** (termination message), and `get` Secrets.

### One consolidated scheduler Deployment (B4 update — supersedes earlier drafts)

The backup loops landed as a **single** `backups` bin/Deployment, not the
three-then-four separate ones earlier drafts described. One pod runs the
preflight, maintenance, inspection, and s3-metrics loops as concurrent tasks
(preflight is AWS STS/S3-touching; s3-metrics is AWS CloudWatch-touching). All
share the `canopy-jobs` SA, so there is nothing isolation-wise to gain from
separate pods — see B4.

**No separate `backup-staleness` Deployment, and `reachability` is renamed.**
The staleness + report-vs-inventory reconciliation sweep is DB-only and
minute-cadence, so it was folded into the existing reachability loop rather
than its own bin/pod — there is no `backup_staleness` binary. Because that loop
now also runs the staleness sweep (on top of reachability + tailnet
key-expiry), the Canopy bin was **renamed `reachability` → `monitor`**; rename
the existing Deployment's command (and name) accordingly.

### Scheduler env config the Deployment must set

Read from env (like `DATABASE_URL`) by the single `backups` Deployment:
`CANOPY_NAMESPACE`, `CANOPY_BACKUP_IMAGE`, `CANOPY_BACKUP_MAINTENANCE_SA`,
`CANOPY_BACKUP_INSPECTION_SA`, `CANOPY_BACKUP_PASSWORD_KEY` (default
`password`). (The `*_SA` vars name the SAs put on the **spawned per-group
Jobs**, which stay separate — not the scheduler pod's own `canopy-jobs` SA.)

### S3-metrics CloudWatch read (assume-the-group-role)

The s3-metrics loop calls `GetMetricStatistics` on `AWS/S3` `BucketSizeBytes`
with dimensions `BucketName=<bucket>` + **`StorageType=StandardStorage`** (the
standard storage class — versioned objects are still counted under their
class). The metric is in the **deployment** account → the loop **assumes the
group's per-bucket role** (the same `target_role_arn` preflight assumes) and
reads CloudWatch with those cross-account creds. **Ops change:** the per-bucket
role must grant **`cloudwatch:GetMetricStatistics`** (in addition to the S3
actions). No cross-account CloudWatch permission is needed on `canopy-jobs`
itself, and there is no dedicated metrics IRSA.

### Per-bucket role must allow the restore session-policy base actions

The `restore` session policy canopy ANDs down to is `s3:GetObject` +
unconditioned `s3:GetBucketLocation` + prefix-conditioned `s3:ListBucket`. The
per-bucket (device) role's own policy must already grant these (it does via
`AWS_S3_MULTIPART_ACTIONS`), or the restore leg returns nothing usable.

### `k8s-openapi` pinned to `v1_32`

Canopy's jobs + public-server crates pin `k8s-openapi = 0.27.1` features
`["v1_32"]`. **Confirm `v1_32` matches the EKS control-plane version**; a
mismatch is only a feature-flag bump on the canopy side, but it must agree
with the cluster.

    claude --resume 24a97465-17bb-4214-a7ae-605a14281f43

# Moving off Pulumi's hosted backend — notes

Exploratory notes, not a committed plan. Captures the options, the
constraints specific to our setup, and the open questions.

Two avenues are in play:

1. **Pulumi open-source free tier** (likely preferred) — stay on Pulumi Cloud
   at $0, keeping ESC, the org model, stack refs, the secrets service, and the
   UI. Requires the Pulumi *code* to be publicly available. See "Free-tier
   avenue" below.
2. **Self-managed (DIY) backend** — fallback if free-tier eligibility is
   rejected. See "DIY backend avenue" below.

## Where we are today

- 194 stacks across 28 projects, all on Pulumi Cloud's hosted backend
  (`app.pulumi.com`, org `bes`), implicitly — no `backend:` key anywhere.
- Secrets via the Pulumi service (default `AAABA…` encryption), ~30 `secure:`
  values across stack configs.
- 93 cross-stack reference appearances (28 distinct) using org-qualified names
  like `bes/core/tamanu-internal`.
- No deploy CI; `pulumi up` runs from dev machines. Credentials in Bitwarden.
- AWS access is **not** universal: only stacks that need AWS run through
  `aws-sso`. That excludes all k8s workload stacks except `k8s-core`.
  Roughly 84 stacks need AWS, ~110 are k8s-only and reach the cluster over
  Tailscale with no AWS auth at all.

## Driver

Cost. We want to reduce/eliminate Pulumi Cloud spend. This points at a
self-managed (DIY) backend rather than self-hosted Pulumi Cloud (which keeps
all features incl. ESC and the org model, but is a paid enterprise product and
means running stateful infra — only worth it if the driver were data
residency/compliance, which it isn't).

## ESC — smaller than it looks

36 on-linux stacks import a Pulumi ESC environment (`tamanu-on-linux`). DIY
backends don't support ESC, so this looked like a blocker. It isn't:

- The environment's whole job is injecting three Tailscale provider creds:
  `tailscale:apiKey`, `tailscale:oauthClientId`, `tailscale:oauthClientSecret`.
- It's the **same shared credential set** for all the stacks, not per-stack
  secrets. `tamanu/meta` already proves the alternative by putting the Tailscale
  client id/secret directly in its stack config.
- Only the `tamanu/on-linux` project uses ESC. Everything else is ESC-free.
- The Tailscale provider reads `TAILSCALE_API_KEY` /
  `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` from the
  environment. So ESC can be replaced by a wrapper that exports those three
  vars (sourced from Bitwarden) before `pulumi up` — same shape as our existing
  `aws-sso exec -- pulumi …` wrapping. One project touched, no per-stack churn.

## Free-tier avenue (likely preferred)

Pulumi's open-source free tier gives Team Edition at $0 — we stay on Pulumi
Cloud and keep ESC, the org model, stack refs, the secrets service, the UI,
deployment dashboards, RBAC, and CI/CD integrations. None of the DIY costs
below apply. The price of admission is publishing the Pulumi *code*.

### Eligibility

Requirements from the pricing page: OSI-approved license; project active and
>30 days old; applicant is a maintainer/core contributor; **not primarily
funded or controlled by a for-profit company**; and **Pulumi code publicly
available**. The for-profit clause is satisfied now that we are a non-profit
(BES International). Stack config and state are not "code", so they can stay
private. Still needs the formal application (2–5 business-day review).

Independent of Pulumi's decision: closed-source infra repos are an org
anti-pattern, so publishing is the goal regardless — which makes the
client-identity work below the central task either way.

### Decision: split public code / private config

- **Public:** all program code — `src/`, `common/`, templates, `Pulumi.yaml`
  project files. The scan shows this is almost entirely generic.
- **Private (gitignored, stored elsewhere):** every `Pulumi.<stack>.yaml`
  stack config. These carry the client identity (per-deployment stack names,
  domains, IAM names, tags) and the encrypted `secure:` values.

Ignore pattern must be `Pulumi.*.yaml*` — there are committed `.yaml.bak` and
`.yaml.bak.bak` stack-config copies in the tree today; delete them outright and
make sure the pattern stops backups reappearing.

### Small code-scrub tail

Client identity hardcoded in committed program code (genericize or move to
config before publishing):

- `pulumi/data/dbt-docs/constants.ts` — a comment naming deployments, plus
  hardcoded secret ARNs with an account ID → genericize comment, move ARNs to
  config.
- `pulumi/tamanu/on-linux/src/config.ts` — a deployment example in a comment.
- `pulumi/tamanu/dhis2/src/config.ts` — a hardcoded `product:` value.
- `pulumi/tamanu/k8s-infra/templates/rc/provisioning.json5.njk` — a hardcoded
  provisioning email / display name → parameterize.

### Mandatory regardless: rotate exposed secrets

- `pulumi/tamanu/k8s-infra/system/secrets.ts` — hardcoded API keys.
- `pulumi/data/tamanu-replica/Pulumi.*.yaml` — AWS access key IDs in plaintext.

These have been in git, so a history rewrite cleans the new repo but cannot
un-expose them — **rotate, don't just scrub**. The 41 `secure:` values are safe
to publish (ciphertext, still decryptable by the Pulumi Cloud service key under
the free tier).

### Mechanics

- **Split:** `git filter-repo` to carve `pulumi/` + `docs/` into a new repo with
  history.
- **History scrub:** path-glob removal of `Pulumi.*.yaml*` across all history
  (easy); `--replace-text` for the plaintext secrets.
- **Private config store:** stack configs live in a separate private repo (or
  store). Pulumi reads `Pulumi.<stack>.yaml` from the project dir, so they must
  sync into place before `pulumi up` — a per-project git submodule (gitignored
  path) or a sync step in the pulumi wrapper. Adds a checkout/sync prerequisite.
- **Audit:** run `gitleaks`/`trufflehog` over full history for secrets; the
  pattern grep done so far is a floor, not a ceiling.

## DIY backend avenue (fallback if free tier is rejected)

## The real cost of DIY: don't break the AWS / no-AWS split

A DIY backend puts state in an object store, and **every `pulumi up` must
authenticate to that store** to read/write state — regardless of whether the
stack itself touches AWS.

- Put state in real AWS S3 → all ~110 k8s-only stacks now need `aws-sso` just to
  reach the state bucket. That undoes their defining property (Tailscale-only,
  no AWS).
- Same trap with AWS KMS as the secrets provider: decrypting config would drag
  AWS creds into every k8s stack operation.

So the naive "one S3 bucket + KMS" plan quietly regresses our cleanest
operational property. The backend-store decision is the load-bearing one.

### Choices that preserve the split

1. **Secrets: `passphrase` everywhere, not KMS.** Passphrase decryption needs
   no cloud, so it doesn't reintroduce AWS auth into k8s stacks. Store the
   passphrase in Bitwarden alongside the Tailscale creds. (Secrets provider is
   per-stack, so we *could* split KMS for the 84 AWS stacks / passphrase for the
   110 k8s — but uniform passphrase is simpler and keeps the property clean.)

2. **State store reachable the same way k8s stacks already reach things —
   over Tailscale.** Two sub-options:
   - **Self-hosted MinIO on the tailnet.** Zero AWS dependency anywhere, but we
     own durability (volume backups/replication).
   - **S3 proxy on the tailnet → real AWS S3.** AWS owns durability; we run only
     a stateless translation/auth layer. See below.

## S3 proxy option (don't own storage, only require Tailscale)

Goal: real storage = AWS S3 (durability owned by AWS), access path = a stateless
node on the tailnet that holds the real AWS creds. Stacks need only Tailscale.

- **`gaul/s3proxy` (Andrew Gaul's S3Proxy) — best fit.** Presents an S3 API,
  backends to AWS S3 with creds it holds. Clients authenticate with
  proxy-local static creds (Bitwarden), so no AWS auth leaks into stacks. It's a
  real S3 server validating its own identity, so it accepts SDK-signed requests
  correctly. Stateless: restart on failure, no data loss (state is in S3).
- **`awslabs/aws-sigv4-proxy` — poor fit here.** It SigV4-signs *unsigned*
  incoming requests. Pulumi's DIY S3 backend uses the AWS SDK, which always
  signs, so you get a double-signing conflict and there's no clean "don't sign"
  switch. Great for plain HTTP clients, not for this SDK client.
- **MinIO Gateway — dead.** Gateway mode was removed in 2022; ignore stale
  guides recommending it.
- **SeaweedFS / Garage / Versity GW — not proxies.** Storage systems with an S3
  face; using them means owning durability again. Out of scope for this goal.

### s3proxy deployment shape

- Run s3proxy as a stateless Deployment on `k8s-core` (already has AWS access),
  with an IRSA role scoped to just the state bucket — the only place real AWS
  creds live is that one pod, via a role, not static keys.
- Expose on the tailnet via the Tailscale operator (same mechanism as our
  `k8s-operator-*.ts.net` MagicDNS / ts-relay setup) for a stable tailnet name.
- Stacks set
  `PULUMI_BACKEND_URL=s3://<bucket>?endpoint=<magicdns>&s3ForcePathStyle=true&region=<r>`
  plus static proxy creds as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` env
  vars. Reaching state then requires only Tailscale.

### s3proxy caveats

- **Verify Pulumi's S3 locking path round-trips through s3proxy.** Pulumi writes
  lock objects under `.pulumi/locks/`; confirm acquire/release works through the
  jclouds AWS backend before trusting it for concurrent runs.
- The proxy becomes a chokepoint for all pulumi ops, but it's stateless
  (easily 2-replica HA) and an outage blocks only deployments, never running
  infra, with no state to lose.

## Bootstrapping concern

If the state backend (MinIO or s3proxy) is itself a Pulumi-managed k8s
deployment on `k8s-core`, we'd be using Pulumi to manage the thing Pulumi relies
on to function. Chicken-and-egg:

- Changing/recreating the backend service can't safely be done by the very
  stack whose state lives behind it.
- A cold start (cluster rebuild, backend wiped) needs the backend to exist
  before any stack — including the one defining the backend — can be operated.

Options to think through (not yet decided):

- Keep the backend-defining stack on a **different** backend (e.g. its own
  state in real AWS S3 accessed via aws-sso, accepting that this one stack needs
  AWS), so the bulk of stacks use the Tailscale-reachable backend while the
  bootstrap stack doesn't depend on it.
- Or manage the proxy/MinIO **outside Pulumi** (plain manifests / a tiny
  separate tool) so nothing in the main Pulumi graph depends on its own output.
- Or accept a documented manual bring-up procedure for the backend before
  Pulumi can run, kept deliberately simple.

## Rough migration workstreams (all scriptable, fit "apply to all at once")

1. Stand up the backend store (MinIO or s3proxy + bucket) with the bootstrap
   answer decided first.
2. State move, 194 stacks: per-stack `stack export` from cloud → `login` to new
   backend → `stack init` + `import`.
3. Secrets re-key, 194 stacks: `pulumi stack change-secrets-provider passphrase`.
4. Stack-ref rename, ~28 strings: DIY backends force the org segment to the
   literal `organization`, so `bes/<project>/<stack>` → `organization/<project>/<stack>`.
   This is a code change (StackReference args), verified via the existing
   typecheck Action.
5. Retire ESC: one wrapper exporting the three Tailscale env vars for the
   on-linux project.

## What we give up vs Pulumi Cloud

Web UI, deployment history/diffs, drift detection, RBAC, audit log, ESC. With
manual `pulumi up` and no deploy CI we lean on little of this. Locking survives
(S3 backend has supported it since Pulumi 3.x). We take on state durability
ownership (mitigated by bucket versioning, or by AWS S3 in the proxy variant).

## Open questions

Free-tier avenue (preferred):

- Submit the free-tier application and confirm eligibility under non-profit
  status.
- Where do the private stack configs live — separate private repo as submodule,
  or another store — and how does the pulumi wrapper sync them into place?
- Full `gitleaks`/`trufflehog` history audit, and rotation plan for the exposed
  plaintext secrets.

DIY avenue (fallback):

- MinIO (own durability) vs s3proxy → AWS S3 (own only a stateless proxy)?
- Confirm Pulumi S3 locking works through s3proxy.
- Confirm the Tailscale operator can expose the chosen backend service cleanly.
- Decide the bootstrap approach for the backend-defining stack.
- passphrase vs split passphrase/KMS for secrets.

# Canopy machine access via Tailscale app capabilities — notes

**Status: PARKED (2026-06-20).** Decision: do **not** build machine (non-interactive) auth to
Canopy's private admin API yet. Park until the **Tailscale Kubernetes operator Ingress supports
app-capability header forwarding directly** (declaratively). Until then, humans running
`pulumi up` remain authorized via the existing email allowlist, and automated callers are not
enabled.

These are investigation notes, not a plan or an implementation.

## What we wanted

A Tailscale-native, **scoped** way for a non-interactive machine to call Canopy's private admin
API — first consumer a GHA runner registering backup configs (`CanopyBackupConfig`, skeletoned in
`pulumi/common/canopy/`), later a k8s component. Not full meta-admin.

## Why it's blocked today

- Canopy's private-server sits behind the **Tailscale operator Ingress** and authorizes callers by
  an **email allowlist read from Tailscale identity headers** (`Tailscale-User-Login`).
- **Identity headers are populated only for users, not tagged devices.** A tagged machine (GHA/k8s
  via workload identity federation) has no user/email, so it cannot use the email path.
- **App-capability grants *can* be delivered for tagged devices** as the
  **`Tailscale-App-Capabilities`** header (serialised JSON) — but only via
  `tailscale serve --accept-app-caps <cap>`. The operator **Ingress** does **not** expose this
  declaratively as of operator **1.94.2** (Tailscale lists it as "coming soon").
- Reading caps today would require the endpoint to run its **own Serve/tsnet node** (precedent:
  `golink` reads `tailscale.com/cap/golink` because it runs its own tsnet node, not behind the
  operator ingress — `pulumi/golinks/index.ts`). That means moving Canopy's admin endpoint off the
  operator ingress onto a sidecar/tsnet — extra moving parts we're choosing **not** to take on now.
- (Workload identity federation / "OIDC trust" for tagged GHA/k8s nodes already works and is wired
  in `pulumi/k8s-essentials/tailscale.ts` via the `audience` path — so the *identity* half is not
  the blocker; the *cap-reading* half is.)

## What unblocks it

The operator Ingress gaining **declarative app-caps forwarding** (a ProxyClass / Ingress
annotation equivalent to `serve --accept-app-caps`). Watch the Tailscale operator release notes.

## Sketch for when it's unblocked (do not build now)

- **tailscale repo:** add a scoped grant on `servers/tamanu/meta.mjs`-style module:
  `src: [tag:infra-gha-canopy]`, `dst: [tag:server-tamanu-meta]`, `ip: HTTPS`,
  `app: { "tamanu.app/cap/canopy-backup": [{ actions: ["upsert","get","delete"] }] }`.
  (`tag:infra-gha-canopy` already exists, empty-owner = OIDC/oauth-assignable.)
- **canopy repo:** annotate the existing ingress to forward `Tailscale-App-Capabilities`; authorize
  machine callers by parsing that header (scoped to `actions`), keeping the human email path. No
  sidecar needed once the ingress supports it.
- **ops repo:** `pulumi/common/canopy/` client is unchanged (no auth header; tailnet identity); the
  GHA runner joins the tailnet via WIF tagged `tag:infra-gha-canopy` before `pulumi up`.

## Interim

Humans run pulumi locally and are authorized by email. `CanopyBackupConfig` stays inert anyway
(its endpoint shapes are pending Canopy's OpenAPI — `TODO(TAM-6877)`).

## Sources

- [Tailscale app capabilities (blog)](https://tailscale.com/blog/app-capabilities)
- [Application capabilities (KB 1537)](https://tailscale.com/kb/1537/grants-app-capabilities)
- [Troubleshooting grants — identity headers only for users, not tagged devices](https://tailscale.com/docs/reference/troubleshooting/grants)
- [Kubernetes operator customization (workload identity federation)](https://tailscale.com/kb/1445/kubernetes-operator-customization)

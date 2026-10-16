# HNC to Kyverno Migration Plan

Migration off Hierarchical Namespace Controller to Kyverno-driven RoleBinding propagation and namespace gating.

## Background

HNC is currently used for one job: working around the lack of namespace-selector RBAC in Kubernetes. Two ClusterRoles (`tamanu-deploy`, `tamanu-engineer`) are bound once in `tamanu-super` and propagated by HNC into every child namespace; new tamanu-* namespaces inherit the bindings automatically. CI also creates namespaces by writing a `SubnamespaceAnchor` into `tamanu-super` on PR-open (and deleting the anchor on PR-close, relying on HNC cascade to take the namespace and everything in it).

Upstream HNC was archived 2025-04-07; v1.1.0 is the terminal release. We currently dodge the amd64-only image via a JIT init-container build (see `kubernetes.md` §2.8), but staying on a frozen, single-purpose project long-term isn't where we want to be.

Capsule was considered and rejected: it carries more conceptual weight (Tenants, projection, ResourceQuota policies) than the actual workaround needs. Kyverno is lighter, already useful for other policy work we'd want to do anyway, and the RBAC propagation maps to a single `generate` policy.

## Target

- Plain `Namespace` objects with a label, e.g. `tamanu.bes.au/tenant=tamanu-super`.
- Kyverno `ClusterPolicy` (generate) per propagated RoleBinding: when a labelled namespace appears, generate the binding in it. Kyverno also keeps generated resources in sync if the source changes.
- Kyverno `ClusterPolicy` (validate) on `Namespace` create: enforce a name pattern (`^tamanu-[a-z0-9-]+$`) for the `tamanu-deploy` group, so namespace-create permission stays scoped without HNC's anchor indirection.
- HNC, its CRDs, and the dedicated x86 system pool gone.

## Phases

### 1. Install Kyverno

- New stack module `pulumi/k8s-essentials/kyverno/`. Helm chart-based install. Pin a version in `versions.ts`.
- Kyverno itself (admission, background, cleanup, reports controllers) — let it land on the existing `system-arm-v2` pool. Multi-arch images.
- Webhook `failurePolicy: Ignore` initially across the board. Flip to `Fail` per-policy only where the failure mode is acceptable.

### 2. Author policies in audit mode

- One generate `ClusterPolicy` per binding currently inherited from `tamanu-super`. Source of truth is `pulumi/k8s-essentials/hnc/roles.ts` and the bindings actually living on `tamanu-super` today.
- One validate `ClusterPolicy` for the namespace-name pattern, in audit mode.
- Watch `PolicyReport` / `ClusterPolicyReport` CRs for at least a week. Compare generated bindings against what HNC has propagated; reconcile any drift before continuing.

### 3. Backfill labels on existing tamanu-* namespaces

- One-shot: label every existing `hnc.x-k8s.io/subnamespace-of=tamanu-super` namespace with `tamanu.bes.au/tenant=tamanu-super`. Same for `dagster` if it's still using HNC (`pulumi/data/dagster/src/namespace.ts`).
- Confirm Kyverno generate policies populate bindings on every labelled namespace.

### 4. Switch CI and Pulumi to plain Namespaces

- GitHub Actions PR-open workflow: create a `Namespace` with the tenancy label instead of a `SubnamespaceAnchor`. PR-close: delete the Namespace directly (no HNC cascade needed because the namespace owns its own children).
- `pulumi/tamanu/on-k8s/src/namespace.ts`:
  - `externalNamespace: false` path — drop the `SubnamespaceAnchor` and `HierarchyConfiguration`, create a plain `Namespace` with the tenancy label.
  - `externalNamespace: true` path — same as today (`Namespace.get`), no change beyond the label being on the externally-created object.
- `pulumi/data/dagster/src/namespace.ts` — same pattern.

### 5. Flip validate policy to enforce

- After everything's been creating plain Namespaces for a release cycle and the audit reports are quiet, change the validate policy's `failurePolicy: Fail` (and `validationFailureAction: Enforce`).
- Generate policies stay non-blocking — they only fire on resource events, no admission gating.

### 6. Decommission HNC

- Convert each existing subnamespace to a plain namespace by removing the HNC ownership — annotate with `hnc.x-k8s.io/non-propagate-anchor` (verify the exact mechanism in HNC v1.1.0 docs; the goal is "drop the anchor relationship without cascading-delete the namespace").
- Delete `SubnamespaceAnchor` and `HierarchyConfiguration` CRs.
- Remove `pulumi/k8s-essentials/hnc/` entirely.
- Drop `apiGroups: ['hnc.x-k8s.io']` rules from `pulumi/tamanu/k8s-infra/roles/deploy.ts` and `pulumi/k8s-essentials/roles/oncall.ts`.
- Delete the `system-x86-v2` pool from `pulumi/k8s-core/nodes/groups.ts` (the karpenter migration plan already references the `hncEnabled` gate for this).
- Update `docs/kubernetes.md` §2.8, `docs/tamanu-on-k8s.md` §1.1–1.2.

## Open Questions

- **Cluster-admin escape hatch on the validate policy.** Probably exempt cluster-admin from the namespace-name pattern requirement (escape hatches matter for incidents). Decide the exempt subjects up front.
- **HierarchicalResourceQuota usage.** HNC's roles include HRQ propagation rules but no HRQ CRs are visible in the cluster. Confirm none are in use before dropping the role grants.
- **Migration of in-flight PR namespaces.** Live migration order — install Kyverno → audit-mode policies → backfill labels → swap CI → drain HNC over a quiet period — should work without disrupting open PRs. Worth a dry-run on a handful of namespaces in audit before committing.
- **`tamanu-seed` and other HNC-isolated namespaces.** Per `docs/tamanu-on-k8s.md`, `tamanu-seed` is intentionally outside the HNC tree. Its absence of a tenancy label means Kyverno generate policies skip it — confirm that's the intent and not an accidental gap.

## References

- HNC archive: https://github.com/kubernetes-sigs/hierarchical-namespaces (archived 2025-04-07).
- Kyverno generate: https://kyverno.io/docs/writing-policies/generate/.
- Current HNC config: `pulumi/k8s-essentials/hnc/`.
- Current HNC role grants: `pulumi/k8s-essentials/hnc/roles.ts`, `pulumi/tamanu/k8s-infra/roles/deploy.ts`, `pulumi/k8s-essentials/roles/oncall.ts`.
- Tamanu deploy RBAC overview: `docs/tamanu-on-k8s.md` §1.1–1.2.

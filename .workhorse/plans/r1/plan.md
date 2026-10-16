# Rewrite specs in RFC voice

## Settled

- Specs stay in `docs/spec/`. Voice rules: spec-voice skill `style.md`.
- Root spec `docs/spec/overview.md` (id `OVR`): requirements notation, external documents, terminology. No spec index.
- Ids, no prefix: `PGS` pgsnap, `PPB` postgres-physical-backup, `ING` kubernetes/ingress, `K8SNOD` nodes, `K8SPGC` postgres, `K8SVOL` volumes, `TRO` tamanu/renderer-rollout. The requested `K8S-NOD` form breaks the 2 to 6 alphanumeric rule in `.agents/docs/spec-format.md`, so hyphens are dropped.
- Citations: `// spec: ID#heading-slug`, topic-section grain (`##` per topic). Per-requirement tracey ids and `+N` revisions are dropped. Remove `.config/tracey/config.styx`, `tracey` mentions, and the tracey skill reference.
- Ingress spec describes the end state (Envoy Gateway) only. nginx and migration rules move to `docs/plans/canopy-envoy-migration.md`.
- postgres-physical-backup stays, cut to the producer contract. Diagnosis and field evidence go to a docs write-up. Open questions are re-evaluated; still-open ones become cards in the bestool repo.

## Conventions from the pilot (nodes)

- Value sets and label shapes in tables; one normative sentence per row-implied rule.
- Scope requirements to the pool class that carries them (`general workload pool`) instead of stating an exemption.
- Keyword calls: MUST for reliability, security, product commitments; SHOULD for cost-only optimisations (spot price cap, consolidation, spot-first).
- Rationale survives only as a `> [!NOTE]` where cutting it would let a re-implementer build a bad variant.
- Coined terms in overview glossary with `Defined in`; borrowed terms in a per-spec `## Borrowed terms` table.

## Gaps and divergences

- Open: `bes.node.schedule` for a `mixed` pool (db-replica) is set to `spot` in code, though nodes may be on-demand. Spec says it reflects the backing capacity type. Code diverges.
- Open: replica pool "low spot interruption" had no threshold. Spec now applies the 10% limit; code uses a hand-picked list (`x8g.medium`, `x8g.large`, `r6g.large`) that has not been checked against it.
- Resolved from code: critical pool window is 14:00 to 16:00 UTC; exit node instance tag is `bes.node.purpose=tailscale-exit`; burstable exclusion applies to every `workload` pool, not only "large" ones (original undefined "large").
- Resolved: exit node isolation excepts daemonsets (code comment says daemonsets ride every node).

## Rollout

- [x] Pilot: `overview.md`, `kubernetes/nodes.md`
- [ ] Voice sign-off
- [ ] Terminology sweep across all specs
- [ ] Ids and citations sweep (code, workflows, plan docs, `docs/kubernetes.md`)
- [ ] `kubernetes/volumes.md`
- [ ] `kubernetes/postgres.md`
- [ ] `kubernetes/ingress.md` (+ move migration rules to the plan doc)
- [ ] `tamanu/renderer-rollout.md`
- [ ] `pgsnap.md`
- [ ] `postgres-physical-backup.md` (+ write-up, bestool cards)
- [ ] Link and anchor checker in CI
- [ ] Remove tracey config and references

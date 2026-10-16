# Rewrite specs in RFC voice

## Settled

- Specs stay in `docs/spec/`. House rules are in `.workhorse/rules.md`.
- Root spec `docs/spec/overview.md` (`OVR`): requirements notation, external documents, terminology. No spec index.
- Ids, no hyphens: `PGS`, `PPB`, `K8SING`, `K8SNOD`, `K8SPGC`, `K8SVOL`, `TRO`.
- Citations are `spec: ID#section` at topic grain. Tracey ids, `+N` revisions and `.config/tracey` are gone.
- Ingress spec describes the end state only. nginx and migration rules live in `docs/plans/canopy-envoy-migration.md#migration-rules`.
- Physical backup spec is cut to the producer contract. Analysis moved to `docs/postgres-physical-backup-diagnosis.md`. Open questions went to bestool card X3.

## Gaps and divergences

- Code behind spec: `bes.node.schedule` is `spot` for the mixed replica pool even where nodes are on-demand.
- Unchecked: the replica pool's hand-picked instance types against the 10% interruption limit the spec now applies.
- Spec behind code (resolved to code): pgsnap excludes `phase`, `cluster-name`, `snapshot-name`, `from-snapshot` and `snapshot` from passthrough; `for-version` was undefined and is now in the contract; physical backup falls back to base backup when a snapshot fails.
- New in spec from code: new claims start empty (EFS unique directory); a deployment warns when reclaim is enabled but not performed; channel label key and ten-minute promotion limit.
- Open: the Gateway has a TCP 80 redirect listener but the Envoy NLB serves only 443 TCP and UDP.
- Open: external-dns watches only `gateway-httproute` in the spec; the Tailscale IngressClass may still need the `ingress` source.
- Open: huge pages and `io_uring` rules lost their premises (nothing provisioned, measured read IOPS). The huge pages rule is now conditional on node support.

## Rollout

- [x] Overview, nodes, volumes, postgres, ingress, renderer rollout, pgsnap, physical backup
- [x] Citation sweep (41 files), tracey removal
- [x] `scripts/check-spec-links.mjs` and `.github/workflows/spec-check.yml`
- [ ] Review by the user
- [ ] Run the TypeScript and Rust tests (not run: no installed dependencies)

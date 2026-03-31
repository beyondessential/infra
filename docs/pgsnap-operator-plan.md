# pgsnap Operator Implementation Plan

## Overview

A single Rust binary using kube-rs, deployed as a Kubernetes Deployment.
Watches for annotated Jobs, manages ephemeral CNPG clusters, creates volume
snapshots, and garbage-collects old ones. No database required — all state
is derived from Kubernetes resources.

## Project structure

```
pgsnap/
├── Cargo.toml
├── Containerfile
├── src/
│   ├── main.rs           # entrypoint, controller setup, health server
│   ├── create.rs         # snapshot creation workflow (reconciler)
│   ├── gc.rs             # garbage collection loop
│   ├── cnpg.rs           # CNPG Cluster type definitions and helpers
│   ├── snapshot.rs       # VolumeSnapshot type definitions and helpers
│   └── util.rs           # shared utilities
```

## Key dependencies

- **kube** + **k8s-openapi** — CRD-less operator (watches native Jobs,
  manipulates unstructured CNPG/VolumeSnapshot resources)
- **tokio** — async runtime
- **axum** — health and metrics HTTP server
- **jiff** — datetime handling
- **semver** — version parsing for GC
- **tracing** / **tracing-subscriber** — structured logging
- **prometheus** — metrics
- **serde** / **serde_json** — serialisation
- **anyhow** / **thiserror** — error handling

## Design decisions

### No CRDs

pgsnap doesn't define any CRDs. It watches native `batch/v1 Job` resources
filtered by the `pgsnap.bes.au/create` label. CNPG Clusters and
VolumeSnapshots are manipulated as dynamic/unstructured resources via the
kube-rs `Api<DynamicObject>` interface (with typed wrappers for
convenience).

### State machine via Job annotations

The operator tracks workflow progress using annotations on the Job itself:
- `pgsnap.bes.au/phase` — current phase (e.g. `cluster-creating`,
  `cluster-ready`, `job-running`, `snapshotting`, `complete`, `failed`)
- `pgsnap.bes.au/cluster-name` — name of the ephemeral CNPG Cluster
- `pgsnap.bes.au/snapshot-name` — name of the created VolumeSnapshot

This means no external state store is needed and the operator is fully
restartable — on startup it reconciles all in-progress Jobs.

### Job suspension and connection Secret

The Job must be created with `spec.suspend: true`. The operator creates a
Secret named `pgsnap-<job-name>` containing DB connection details
(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`). The Job's
pod template references this Secret via `envFrom`. The operator unsuspends
the Job once the Secret exists and the DB is accepting connections.

This avoids patching the Job's pod template at runtime — the Job author
knows the Secret naming convention upfront and wires it in at creation
time.

## Phases

### Phase 1: Project scaffold and health server

Spec: `s[runtime.*]`

1. `cargo init` with kube-rs, tokio, axum dependencies.
2. Connect to the cluster via `kube::Client::try_default()`.
3. Start an axum server with `/livez`, `/readyz`, `/metrics`.
4. Set up tracing with JSON output and env filter.

### Phase 2: Snapshot creation reconciler

Spec: `s[create.*]`, `s[annotation.*]`

1. Set up a `Controller` watching Jobs with label selector
   `pgsnap.bes.au/create=true` (label, not annotation, because k8s
   watch selection requires labels).
2. Reconcile loop implements the state machine:
   - **New Job**: ensure `suspend: true`, create CNPG Cluster, annotate
     Job with phase and cluster name.
   - **Cluster creating**: check if the Cluster's `-rw` Endpoints have
     ready addresses. If yes, read the CNPG app Secret, create the
     `pgsnap-<job-name>` connection Secret, set `suspend: false`,
     advance phase.
   - **Job running**: watch Job status. On success, advance to
     snapshotting. On failure, advance to cleanup.
   - **Snapshotting**: create VolumeSnapshot with labels and annotations,
     wait for `readyToUse: true`.
   - **Complete/Failed**: delete CNPG Cluster, set terminal phase.
3. Use `requeueAfter` for polling phases (cluster readiness, snapshot
   readiness).

### Phase 3: Garbage collection

Spec: `s[gc.*]`

1. Spawn a background tokio task that runs every 5 minutes.
2. List all VolumeSnapshots with label `pgsnap.bes.au/managed=true`.
3. Parse `pgsnap.bes.au/for-version` as semver, skip unparsable.
4. Apply retention rules in order:
   a. Per exact version: keep only the latest by `created-at`.
   b. Per minor version: keep only the highest patch.
   c. Keep only the last 10 minor versions.
5. Delete all snapshots not in the retained set.

### Phase 4: Container image and CI

1. Write `Containerfile` following postgres-restore-operator pattern:
   multi-arch (amd64 + arm64), static binary, minimal base image.
2. GitHub Actions workflow: build binaries per arch, build and push
   multi-arch image to `ghcr.io/beyondessential/pgsnap`.
3. Tag-based releases.

### Phase 5: Deployment via Pulumi

1. New Pulumi stack `tamanu/pgsnap` (or add to `k8s-infra`).
2. Deploy: Deployment (single replica), ServiceAccount with RBAC
   (watch/patch Jobs, create/delete CNPG Clusters, create/delete/list
   VolumeSnapshots, get Endpoints), ClusterIP Service for health checks.
3. Namespace: `tamanu-seed` (same as current).

### Phase 6: Tamanu integration

1. Simplify `seed-snapshot.yml` workflow: create a Job with pgsnap
   annotations instead of running Pulumi up/destroy.
2. The Job carries:
   - `pgsnap.bes.au/create: "true"`
   - `pgsnap.bes.au/size: "20Gi"`
   - `pgsnap.bes.au/for-version: <version>`
   - `pgsnap.bes.au/source-branch: <branch>`
   - `pgsnap.bes.au/git-sha: <sha>`
3. The Job is created with `spec.suspend: true` and its pod template
   references `pgsnap-<job-name>` Secret via `envFrom`. The operator
   creates the Secret with connection details and unsuspends the Job.
4. The Job's container runs the migration + fake data commands (same as
   today), reading DB connection from the injected env vars.
5. The seed-snapshot Pulumi stack can be retired — `kubectl apply` +
   `kubectl wait` replaces it.
6. Remove the `pulumi destroy` cleanup step (operator handles it).

## RBAC requirements

The operator's ServiceAccount needs:
- `batch/v1 Jobs`: get, list, watch, patch
- `postgresql.cnpg.io/v1 Clusters`: get, list, create, delete
- `v1 Endpoints`: get, list, watch
- `v1 Secrets`: get, create, delete (read CNPG credentials, create connection Secret)
- `snapshot.storage.k8s.io/v1 VolumeSnapshots`: get, list, create, delete
- `v1 Events`: create (for operator status events)

## Open questions

- **CNPG Cluster naming**: use a deterministic name derived from the Job
  name to make the operator idempotent on restart.
- **Snapshot class**: hardcode `ebs-retain` or make configurable via
  annotation? Start hardcoded, add annotation later if needed.

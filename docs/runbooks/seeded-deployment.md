# Runbook: a seeded deployment starts empty, with the wrong data, or refuses

A deployment can start from a seed snapshot instead of an empty database, and be topped up with generated data.
This covers the ways that goes unexpectedly.

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
Restoring over a live database and forcing the top-up Job by hand are [ruled out](../ruled-out-actions.md#ruled-out-actions-never-suggest).

## 1. When this applies

The stack has `seedSnapshot` set and: the database is empty, the data is from an unexpected version, a snapshot was changed and nothing happened, the update refused, or `central-seed-top-up-*` behaves oddly.

## 2. Establish context

The `seedSnapshot`, `configTemplate` and `nodeEnv` of the stack, and the Tamanu version: [deployment context](../deployment-context.md#reading-the-state). **[diagnose]**

## 3. Investigate

1. **The stub's choice** in the `pulumi up` output: it logs which snapshot it selected, or a warning. **[diagnose]**
2. **The clone**: `kubectl -n tamanu-<stack> get volumesnapshot seed-snapshot`. **[diagnose]**
3. **The top-up Job**: `kubectl -n tamanu-<stack> get jobs` and its logs. **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Warning `No ready seed snapshots` | The stub found none in `tamanu-seed` and starts with an empty database. | Seed snapshots are made by pgsnap ([PGS](../spec/kubernetes/pgsnap.md)): escalate if one should exist. |
| Warning `falling back to newest` | No snapshot matches the deployment's major and minor version, so the newest is used and the migrator brings it forward. | Expected. |
| Warning `No seed snapshot predates v...` | A release rehearsal (`rc` template) seeds from the newest snapshot from before its minor so its migrations run, and there is none, so it starts empty. | Expected, and the migrations run from scratch. |
| Error `seedSnapshot writes fake clinical data` | `nodeEnv` is `production`. Refused on purpose ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#seed-top-up)). | Do not work around it. |
| A snapshot was changed and the data did not change | The central database is restored from the snapshot only when its cluster is first created. | Nothing to fix. A fresh deployment is the route, never a restore over this one. |
| No `central-seed-top-up-*` Job | The top-up needs `seedSnapshot` and Tamanu 2.65.0 or later, and an unknown version counts as older ([K8STDR](../spec/kubernetes/tamanu/deployment-rollout.md#version-gated-steps)). | Check `appVersion`. |
| The top-up Job runs again after a new image | Expected: its name comes from the image tag, so each image runs it once and the old Job is pruned. | Nothing to fix. Do not run it by hand, since it adds records every run. |
| `Seed snapshot ... not yet ready` repeating, or `missing driver or snapshotHandle` | The clone did not become ready, or the source snapshot is incomplete. | Escalate: `pulumi/tamanu/on-k8s/src/central/seedSnapshot.ts`. |

The clone includes a cluster-scoped `VolumeSnapshotContent` that a namespace delete does not remove, and `pulumi destroy` does.

## 5. Resolve

Config changes go through [change a deployment's config](../sops/change-deployment-config.md) **[dev-OTS]**.

## 6. Escalate

Escalate for missing snapshots and clone failures.
Give the stack, version, template, and the stub's log lines.

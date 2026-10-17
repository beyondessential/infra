---
id: PGS
---

# pgsnap

pgsnap is a Kubernetes operator that creates PostgreSQL volume snapshots for Jobs and removes old snapshots.

## Borrowed terms

| term | meaning |
|---|---|
| CNPG Cluster | A CloudNativePG `Cluster` resource ([CloudNativePG documentation](https://cloudnative-pg.io/documentation/current/)). |
| VolumeSnapshot, VolumeSnapshotClass | The Kubernetes resources that request a snapshot of a volume and select how it is taken ([Kubernetes volume snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)). |
| `readyToUse` | The `VolumeSnapshot` status field that is true once the snapshot can be restored from ([Kubernetes volume snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/)). |
| suspended Job | A Job whose `spec.suspend` is true, so that it creates no pods ([Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/#suspending-a-job)). |
| owner reference | The metadata that makes Kubernetes delete an object when its owner is deleted ([Kubernetes owners and dependents](https://kubernetes.io/docs/concepts/overview/working-with-objects/owners-dependents/)). |
| semver | A version in the form `major.minor.patch`, with its precedence rules ([Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)). |
| minor | The `major.minor` part of a semver version. |

## Scope

pgsnap MUST watch and manage resources only in the namespace it is deployed to.

## Annotation contract

All pgsnap annotations and labels MUST use the prefix `pgsnap.bes.au/`.

A Job MUST carry the label `pgsnap.bes.au/create: "true"` for pgsnap to manage it.

A Job MAY carry the annotations in the following table.

| annotation | meaning | default |
|---|---|---|
| `pgsnap.bes.au/size` | The storage size of the [ephemeral cluster](overview.md#ephemeral-cluster). | `20Gi` |
| `pgsnap.bes.au/cpu` | The CPU request and limit of the PostgreSQL container of the ephemeral cluster. | `250m` |
| `pgsnap.bes.au/memory` | The memory request and limit of the PostgreSQL container of the ephemeral cluster. | `1Gi` |
| `pgsnap.bes.au/for-version` | The semver version of the application whose data the snapshot holds. | none |
| `pgsnap.bes.au/from-snapshot` | The existing snapshot the database is restored from, instead of starting empty. | none |
| `pgsnap.bes.au/snapshot` | Whether a VolumeSnapshot is produced, where `false` suppresses it. | `true` |

pgsnap MUST record its progress on the Job in the annotations in the following table.

| annotation | meaning |
|---|---|
| `pgsnap.bes.au/phase` | One of `new`, `cluster-creating`, `job-running`, `snapshot-waiting`, `complete` and `failed`. |
| `pgsnap.bes.au/cluster-name` | The name of the ephemeral cluster, `pgsnap-<job-name>` unless the annotation was already present. |
| `pgsnap.bes.au/snapshot-name` | The name of the VolumeSnapshot, `pgsnap-<job-name>-<UTC time as yyyymmddhhmmss>`. |

### Source snapshot

The value of `pgsnap.bes.au/from-snapshot` MUST be the name of a snapshot, an exact `for-version`, or `previous`.

Only a snapshot that is ready to use MAY be selected as the source.

Where several snapshots carry the requested `for-version`, pgsnap MUST select the most recently created.

Where the value is `previous`, pgsnap MUST select the snapshot with the highest `for-version` among those whose minor is lower than the minor of the Job's own `for-version`.

> [!NOTE]
> The Job's migrations then meet data they have not been applied to.
> A snapshot of the same minor is skipped even at a lower patch, because a snapshot of a release branch already carries its migrations.

Where the value is `previous` and the Job's own `for-version` is not a valid semver version, the source MUST be treated as unresolvable.

Where the requested source cannot be resolved, pgsnap MUST mark the Job `failed`, MUST NOT create an ephemeral cluster for it, and MUST delete the Job.

> [!NOTE]
> A Job that never starts is reaped by neither its own deadline nor its time-to-live.
> A client waiting on the Job observes either the phase `failed` or the disappearance of the Job.

### Passthrough annotations

A [passthrough annotation](overview.md#passthrough-annotation) of a Job is every annotation with the pgsnap prefix other than `create`, `size`, `cpu`, `memory`, `phase`, `cluster-name`, `snapshot-name`, `from-snapshot` and `snapshot`.

pgsnap MUST copy every passthrough annotation of a Job to the VolumeSnapshot it produces.

pgsnap MUST add the annotation `pgsnap.bes.au/created-at`, holding the UTC time of snapshot creation, to the VolumeSnapshot.

## Snapshot creation

An ephemeral cluster is a single-instance CloudNativePG cluster that pgsnap creates for one Job and deletes afterwards.

A Job managed by pgsnap MUST be created suspended.

pgsnap MUST unsuspend the Job only once the database accepts connections and the connection Secret exists.

pgsnap MUST create the ephemeral cluster with a single instance, and with the storage size, CPU and memory given by the Job's annotations.

The ephemeral cluster MUST run the same PostgreSQL major version as the clusters its snapshots are restored into.

pgsnap MUST wait until the read-write service of the ephemeral cluster has at least one ready address before it proceeds.

Where the Job requests a source snapshot, pgsnap MUST bootstrap the ephemeral cluster from that snapshot.

The connection details pgsnap hands to a Job restored from a snapshot MUST be those of the superuser of the cluster.

pgsnap MUST create a Secret named `pgsnap-<job-name>` with the keys `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME` and `DB_PASSWORD`.

The pod template of the Job MUST reference that Secret through `envFrom`.

pgsnap MUST watch the Job until it succeeds or fails.

After the Job succeeds, pgsnap MUST create a VolumeSnapshot of the PVC of the ephemeral cluster, using the `ebs-retain` VolumeSnapshotClass, unless the Job sets `pgsnap.bes.au/snapshot` to `false`.

pgsnap MUST label the VolumeSnapshot `pgsnap.bes.au/managed: "true"`.

pgsnap MUST NOT consider creation complete until the `readyToUse` field of the VolumeSnapshot is true.

After the VolumeSnapshot is ready to use, or after the Job fails, or once the Job finishes with no snapshot requested, pgsnap MUST delete the ephemeral cluster.

The VolumeSnapshot MUST persist independently of the ephemeral cluster.

If the Job fails, pgsnap MUST NOT create a VolumeSnapshot.

The ephemeral cluster and the connection Secret MUST carry an owner reference to the Job.

## Snapshot garbage collection

The garbage collector MUST consider the VolumeSnapshots in its namespace that carry the label `pgsnap.bes.au/managed: "true"`.

The garbage collector MUST ignore a snapshot whose `for-version` is absent or is not a valid semver version.

For snapshots sharing one `for-version`, the garbage collector MUST retain only the one with the latest `created-at`.

For the remaining snapshots sharing one minor, the garbage collector MUST retain only the one with the highest patch version.

The garbage collector MUST retain only the snapshots of the ten highest minors.

The garbage collector MUST delete every snapshot it does not ignore and does not retain.

## Operation

pgsnap MUST expose the HTTP endpoints `/livez` and `/readyz` for Kubernetes probes.

pgsnap MUST expose its metrics at `/metrics` in the [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/).

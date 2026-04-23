# pgsnap

pgsnap is a Kubernetes operator that automates the creation and lifecycle
management of PostgreSQL volume snapshots. It watches for annotated Jobs,
provisions ephemeral CNPG clusters for them, snapshots the resulting data
volume, and garbage-collects old snapshots.

The operator runs in a single namespace and only manages resources within it.

## Annotation contract

s[annotation.prefix]
All pgsnap annotations use the prefix `pgsnap.bes.au/`.

s[annotation.create]
A Job with the label `pgsnap.bes.au/create: "true"` signals pgsnap to
manage its lifecycle: provision a database, inject connection details, wait
for completion, snapshot, and clean up. This is a label (not an annotation)
because Kubernetes watch selectors only support labels.

s[annotation.size]
The annotation `pgsnap.bes.au/size` specifies the PVC storage size for the
ephemeral CNPG cluster. Defaults to `20Gi` if absent.

s[annotation.cpu]
The annotation `pgsnap.bes.au/cpu` specifies the CPU request and limit for
the ephemeral CNPG cluster's PostgreSQL container. Defaults to `250m` if
absent.

s[annotation.memory]
The annotation `pgsnap.bes.au/memory` specifies the memory request and
limit for the ephemeral CNPG cluster's PostgreSQL container. Defaults to
`1Gi` if absent.

s[annotation.passthrough]
All `pgsnap.bes.au/*` annotations on the Job except `/create`, `/size`,
`/cpu`, and `/memory` are copied to the resulting VolumeSnapshot.

s[annotation.created-at]
The operator adds `pgsnap.bes.au/created-at` to the VolumeSnapshot with the
UTC datetime at snapshot creation time.

## Snapshot creation workflow

s[create.scheduling]
When a Job with `pgsnap.bes.au/create: "true"` is created, the operator
must prevent it from running until the database is ready. The Job must be
created with `spec.suspend: true`. The operator unsuspends it once the
database is accepting connections and the connection Secret exists.

s[create.cluster]
The operator creates a CNPG Cluster with a single instance, using the
storage size from `pgsnap.bes.au/size` (default `20Gi`), CPU from
`pgsnap.bes.au/cpu` (default `250m`), and memory from `pgsnap.bes.au/memory`
(default `1Gi`). The cluster is ephemeral and owned by the operator's
workflow for this Job.

s[create.cluster.ready]
The operator waits for the CNPG Cluster's read-write service endpoint to
have at least one ready address before proceeding.

s[create.secret]
The operator creates a Secret named `pgsnap-<job-name>` containing the
database connection details: `DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USERNAME`, and `DB_PASSWORD` (read from the CNPG-generated app user
Secret). The Job's pod template must reference this Secret via `envFrom`
to receive the connection details.

s[create.unsuspend]
Once the database is ready and the connection Secret exists, the operator
sets `spec.suspend` to `false`, allowing the Job to be scheduled.

s[create.wait-completion]
The operator watches the Job until it reaches a terminal state (succeeded
or failed).

s[create.snapshot]
After the Job succeeds, the operator creates a VolumeSnapshot of the CNPG
Cluster's PVC using the `ebs-retain` VolumeSnapshotClass.

s[create.snapshot.labels]
The VolumeSnapshot is labelled with `pgsnap.bes.au/managed: "true"` so the
garbage collector can identify pgsnap-managed snapshots.

s[create.snapshot.annotations]
The VolumeSnapshot carries all passthrough annotations from the Job, plus
`pgsnap.bes.au/created-at`.

s[create.snapshot.ready]
The operator waits for the VolumeSnapshot's `status.readyToUse` to become
`true` before considering creation complete.

s[create.cleanup]
After the snapshot is ready (or if the Job fails), the operator deletes the
ephemeral CNPG Cluster. The VolumeSnapshot persists independently.

s[create.failure]
If the Job fails, the operator still cleans up the CNPG Cluster but does
not create a snapshot.

## Snapshot garbage collection

s[gc.schedule]
The garbage collector runs every 5 minutes.

s[gc.scope]
The garbage collector considers all VolumeSnapshots in its namespace with
the label `pgsnap.bes.au/managed: "true"`.

s[gc.version-parse]
The `pgsnap.bes.au/for-version` annotation is parsed as semver. Snapshots
without a valid semver `for-version` are ignored by the garbage collector.

s[gc.dedup-version]
If two or more snapshots share the same `for-version`, only the one with
the latest `pgsnap.bes.au/created-at` is retained.

s[gc.dedup-minor]
If two or more snapshots share the same major.minor version, only the one
with the highest patch version is retained (after the per-version dedup).

s[gc.retain-minors]
Only snapshots for the 10 most recent minor versions are retained. All
snapshots for older minor versions are deleted.

s[gc.delete]
Snapshots not retained by any of the above rules are deleted.

## Operator runtime

s[runtime.namespace]
The operator watches and manages resources only in the namespace it is
deployed to.

s[runtime.binary]
The operator is a single Rust binary.

s[runtime.health]
The operator exposes `/livez` and `/readyz` HTTP endpoints for Kubernetes
probes.

s[runtime.metrics]
The operator exposes a `/metrics` endpoint in Prometheus format.

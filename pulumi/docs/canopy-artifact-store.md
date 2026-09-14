# Canopy artifact store — what ops owns

Canopy publishes artifacts against a release version: installers, packages, sets
of migrations, reporting schemas. Most rest at a location Canopy records and
does not hold, and whoever is offered one fetches it for itself. An artifact
scoped to a **server group** is different: it is derived from that group's own
data, so Canopy takes the bytes on the registration that publishes them, keeps
them itself, and serves them only to that group. The product design lives in the
`canopy` repo (`.workhorse/specs/platform/artifacts.md`, ART).

What ops owns is the bucket those bytes rest in, the access each pod has to it,
and the environment that tells the pods where it is.

## The bucket

One bucket, created in `canopy-infra` alongside the IRSA roles, so there is no
cross-account `AssumeRole` in this path and `CANOPY_ARTIFACT_ROLE_ARN` is unset.
Objects sit under the `artifacts/` prefix, one per artifact, keyed by the
artifact's own id.

It is **not** a group's backup repo and **not** the recovery vault. An artifact
carries the retention, access and cost basis of an artifact rather than a
backup's, and the vault is versioned and Object-Locked, which is wrong for an
object replaced on every rebuild.

Public access is blocked in full. No caller addresses the store: the group
boundary is enforced on the read, which resolves the artifact against the
caller's scope before it asks for the bytes, and Canopy serves them from its own
endpoint.

## Who gets what

| Pod | Role | Access |
| --- | --- | --- |
| `private-server` | `canopy-private` | `PutObject`, `GetObject`, `DeleteObject` on `artifacts/*` |
| `public-server` | `canopy-issuer` | `GetObject` on `artifacts/*` |
| `backups` | `canopy-jobs` | `DeleteObject` on `artifacts/*`, `ListBucket` on the bucket |

An operator registers and deregisters through `private-server`; a device is
served through `public-server`; the sweep in the `backups` pod lists the prefix
and drops objects no registration reaches. The sweep never reads an artifact, so
it is given no `GetObject`.

`s3:ListBucket` is a bucket-level action and is denied outright against an
object ARN, so it carries a statement of its own against the bucket, conditioned
on the prefix.

## Environment

`CANOPY_ARTIFACT_BUCKET`, `CANOPY_ARTIFACT_REGION` and `CANOPY_ARTIFACT_PREFIX`,
read from the `canopy-infra` stack's outputs by `canopy/src/canopy-artifacts.ts`
and spread into all three deployments.

**All three need the same bucket, and nothing in Canopy checks that they agree.**
A `private-server` with a bucket and a `public-server` without gives successful
uploads and a failure on every device fetch; a `backups` pod without one sweeps
nothing and says so once at startup.

Where the bucket is unset the store is absent rather than fatal: the servers
start, log `CANOPY_ARTIFACT_BUCKET is unset; Canopy can hold no artifact`, and
report it per request. So a deploy that forgot it looks healthy until somebody
registers a group-scoped artifact.

## Order of operations

`canopy-infra` applies **before** `canopy`. The env reads its outputs, so the
other order brings the pods up with no bucket.

## What expires, and what must not

Bytes live as long as the registration that names them. A rebuild replaces the
one object; a deregistration removes it.

There is deliberately **no lifecycle expiry on `artifacts/*`**. A group can sit
on one version for a year without a rebuild, so a rule expiring by age would
delete the bytes of an artifact that is still registered, leaving the row intact
and answering every device with a 404 and nothing to say why. The sweep is what
expires instead: it drops only objects whose id no artifact row carries, and
leaves anything stored within the last day alone, since a registration stores
the bytes before it writes the row that names them.

An archived (soft-deleted) group keeps its artifacts and their bytes. Archival
is reversible by design, and the artifacts are what a restored group would be
served.

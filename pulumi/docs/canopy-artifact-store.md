# Canopy artifact store

Canopy holds the bytes of some artifacts itself rather than recording a location
for them, and this is the bucket they rest in. What the artifacts are and who is
offered one is Canopy's: see `.workhorse/specs/platform/artifacts.md` (ART) in
the `canopy` repo.

Ops owns the bucket, each pod's access to it, and the environment that tells the
pods where it is.

## The bucket

Created in `canopy-infra` alongside the IRSA roles, so there is no cross-account
`AssumeRole` in this path and `CANOPY_ARTIFACT_ROLE_ARN` stays unset. Objects sit
under the `artifacts/` prefix, one per artifact.

It is **not** a group's backup repo and **not** the recovery vault. An artifact
carries the retention, access and cost basis of an artifact rather than a
backup's, and the vault is versioned and Object-Locked, which is wrong for an
object replaced on every rebuild.

Public access is blocked in full. Canopy serves the bytes from its own endpoint
after checking who is asking, so nothing reaches the store directly.

## Who gets what

| Pod | Role | Access |
| --- | --- | --- |
| `private-server` | `canopy-private` | `PutObject`, `GetObject`, `DeleteObject` on `artifacts/*` |
| `public-server` | `canopy-issuer` | `GetObject` on `artifacts/*` |
| `backups` | `canopy-jobs` | `DeleteObject` on `artifacts/*`, `ListBucket` on the bucket |

`s3:ListBucket` is a bucket-level action and is denied outright against an object
ARN, so it carries a statement of its own against the bucket, conditioned on the
prefix. The sweep it serves never reads an artifact, so `canopy-jobs` is given no
`GetObject`.

## Environment

`CANOPY_ARTIFACT_BUCKET`, `CANOPY_ARTIFACT_REGION` and `CANOPY_ARTIFACT_PREFIX`,
read from the `canopy-infra` stack's outputs by `canopy/src/canopy-artifacts.ts`
and spread into all three deployments.

**All three need the same bucket, and nothing in Canopy checks that they agree.**
A `private-server` with a bucket and a `public-server` without gives successful
uploads and a failure on every device fetch.

An unset bucket is not fatal: the pods start, log `CANOPY_ARTIFACT_BUCKET is
unset; Canopy can hold no artifact`, and report it per request. So a deploy that
forgot it looks healthy until somebody registers one.

`canopy-infra` applies **before** `canopy`, since the env reads its outputs.

## No lifecycle expiry here

Do not add an age rule on `artifacts/*`. An artifact's bytes live as long as its
registration, and a group can sit on one version for a year without a rebuild, so
expiring by age would delete bytes a registration still names, leave the row
intact, and answer every device with a 404 and nothing to say why.

Canopy expires them instead, from the `backups` pod, which is what the
`ListBucket` above is for: it drops only objects no artifact row carries.

---
id: BLWEB
---

# Bliti web app hosting

The requirements in this spec apply to the hosting of the [bliti web app](overview.md#bliti-web-app) at `iti.tamanu.app`, and of a preview of it for each pull request of the bliti repository.

## Borrowed terms

| term | meaning |
|---|---|
| bucket, object, key, prefix | An S3 container of objects, a stored file with its metadata, the name of an object within its bucket, and the leading part of a key that groups objects ([Naming objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)). |
| lifecycle rule | A bucket rule that expires objects a set time after their creation ([Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)). |
| distribution, invalidation | A CloudFront configuration that serves content from origins under a set of names, and a request that removes objects from its caches before they expire ([Working with distributions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.html), [Invalidate files](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html)). |
| subject | The `sub` claim of the OIDC token GitHub Actions issues to a workflow job ([OpenID Connect reference](https://docs.github.com/en/actions/reference/security/oidc)). |
| content coding, acceptable | A transformation applied to a representation, such as `gzip`, `br` or `zstd`, and whether the `Accept-Encoding` of a request permits it ([RFC 9110 section 8.4.1](https://www.rfc-editor.org/rfc/rfc9110#section-8.4.1), [section 12.5.3](https://www.rfc-editor.org/rfc/rfc9110#section-12.5.3)). |

## Stack

The hosting MUST be provisioned by one [stack](overview.md#stack) against the [core](overview.md#core) of the Tamanu Internal account.

The stack MUST read the OIDC identity provider for GitHub Actions from the outputs of its core, as described in [CORE](core.md#deployment-identity).

## Bucket

The hosting MUST keep the site in one bucket named `bes-bliti-web`.

The bucket MUST grant read access to its objects only to the distribution.

The bucket MUST deny every request made without TLS.

The bucket MUST hold each site under the prefix of the following table.

| prefix | holds |
|---|---|
| `prod/` | The [production site](overview.md#production-site). |
| `previews/pr-<number>/` | The [preview](overview.md#preview) of the pull request numbered `<number>`. |

The bucket MUST have a lifecycle rule that expires every object under `previews/` 30 days after its creation.

> [!NOTE]
> Expiry counts from when each object was last uploaded, so a deploy that skips unchanged objects leaves those to expire on the schedule of their first upload while the rest of the preview stays.

## Addresses

The production site is the build of the bliti web app that the `production` environment of the bliti repository deploys.

A preview is the build of the bliti web app that a pull request of the bliti repository deploys.

One distribution MUST serve the names `iti.tamanu.app` and `*.iti.tamanu.app`, under one certificate covering both.

The hosted zone that holds `tamanu.app` MUST carry A and AAAA alias records for both names, aimed at the distribution.

The distribution MUST answer a request made without TLS with a redirect to the same address over TLS.

The distribution MUST serve each request from the prefix that its host selects in the following table.

| host | prefix |
|---|---|
| `iti.tamanu.app` | `prod/` |
| `pr-<number>.iti.tamanu.app` | `previews/pr-<number>/` |

The distribution MUST answer a request for any other host under `iti.tamanu.app` with status 404.

## Routing

The distribution MUST serve a request whose path ends in a segment without an extension, including the path `/`, from the object `index.html` under the prefix of its host.

The distribution MUST serve a request for any other path from the object under the prefix of its host whose key continues with that path.

The distribution MUST answer a request with status 404 when no object has the key the request is served from.

## Pre-compressed variants

A variant is an object that stands for another object, its original, in one content coding, under the key of the original followed by the suffix of that coding in the following table.

| content coding | suffix | preference |
|---|---|---|
| `zstd` | `.zst` | first |
| `br` | `.br` | second |
| `gzip` | `.gz` | third |

An original whose key ends in one of the extensions `.html`, `.js`, `.mjs`, `.css`, `.json`, `.svg`, `.wasm` or `.webmanifest` is a compressible object.

A deploy MUST upload a variant in each content coding of the table for every compressible object it uploads, whatever the size of the object.

A variant MUST hold either its original in its content coding, with a `Content-Encoding` naming that coding, or the bytes of its original unchanged, with no `Content-Encoding`.

A variant MUST carry the `Content-Type` of its original.

The distribution MUST serve a request for a compressible object from its variant in the most preferred content coding that the request finds acceptable.

The distribution MUST serve a request for a compressible object that finds none of those content codings acceptable from the original.

The distribution MUST cache each variant apart from its original and from the other variants of that original.

The distribution MUST answer a request for a compressible object with a `Vary` header that names `Accept-Encoding`.

The distribution MUST compress no response from an object that carries a `Content-Encoding`.

## Deploy roles

The hosting MUST have the two deploy roles of the following table, each trusting the OIDC identity provider for GitHub Actions of its core with the audience `sts.amazonaws.com` and only the subject given.

| role | subject | prefix |
|---|---|---|
| `gha-bliti-web-prod` | `repo:beyondessential/bliti:environment:production` | `prod/` |
| `gha-bliti-web-preview` | `repo:beyondessential/bliti:pull_request` | `previews/` |

A deploy role MUST be able to list, read, create, overwrite and delete the objects under its prefix.

A deploy role MUST NOT be able to create, overwrite or delete any object outside its prefix.

A deploy role MUST be able to create invalidations on the distribution.

> [!NOTE]
> The subject of a pull request token names no pull request, so the preview role cannot tell the preview of one pull request from another.

The `production` environment of the bliti repository MUST allow deployments only from the branch `main` and from tags.

> [!NOTE]
> The subject of a job that runs in an environment names the environment and not the ref, so the environment's deployment rules are what keeps other refs out of the production role.

## Outputs

The stack MUST publish the outputs of the following table, under the names given.

| output | meaning |
|---|---|
| `bucket` | The name of the bucket. |
| `distributionId` | The id of the distribution. |
| `prodRoleArn` | The ARN of `gha-bliti-web-prod`. |
| `previewRoleArn` | The ARN of `gha-bliti-web-preview`. |

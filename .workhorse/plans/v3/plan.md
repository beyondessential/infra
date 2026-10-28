# Bliti web app hosting

Infra side of the bliti web app deploy; bliti/H4 is the build and workflow side. Requirements are in `docs/spec/bliti-web.md` (BLWEB).

## Technical notes

- New stack `pulumi/bliti/` (project `bliti`), `src/` layout like `pollen/`, one stack against `bes/core/tamanu-internal`, guarded by `failIfIncorrectAccountOrRegion()`.
- Build on `common/BucketWebsite.ts` with a new optional list of extra names, used for the certificate SANs, the distribution aliases and the A/AAAA records. Every other user of the component keeps the single-name behaviour.
- `ValidCertificate` creates one validation record per domain validation option. ACM gives `iti.tamanu.app` and `*.iti.tamanu.app` the same CNAME, so the two records would collide. Dedupe by record name before creating them.
- `tamanu.app` is the Internal Tamanu core's own zone (`zoneName`/`zoneId` outputs of `bes/core/tamanu-internal`), so take the zone id from `coreRef`. The same core publishes `ghaOidc`. There are no `iti.tamanu.app` records yet, and no `bes-bliti-web` bucket.
- A custom viewer-request function (`requestFunctionSourceFile`) handles three things:
  - Picks the prefix from Host: the apex maps to `prod/`, `pr-<n>.` maps to `previews/pr-<n>/`, and any other host gets a 404 response straight from the function.
  - Pages: `/` maps to `<prefix>index.html`. A path ending in `/` (other than `/`) gets a 308 to the slashless path, keeping the query string. A last segment with no `.` maps to `<prefix><path>.html`. Anything else maps to `<prefix><path>`. There is no fallback to `index.html`. The page rule runs before the encoding rewrite, so pages get their `.html` variants.
  - For compressible extensions, rewrites to `.zst`, `.br` or `.gz`, picking the first of zstd, br, gzip that `Accept-Encoding` accepts and treating `q=0` as not acceptable.
- Because the rewritten URI is the cache key, variants cache apart with no change to the cache policy. CloudFront passes `Content-Encoding` objects through without recompressing, so `compress: true` can stay.
- A custom viewer-response function adds `Vary: Accept-Encoding` to every response, merging with an existing `Vary`, because it can't reliably tell which object a request was served from. The default function's hotlink CORS headers don't apply to this site, so they're left out. Viewer-response functions don't run on origin 4xx responses.
- Missing keys: with OAC and no `s3:ListBucket` for CloudFront, S3 answers 403 for a missing key. `BucketWebsite` gains `listableByDistribution`, which grants the distribution `s3:ListBucket` so S3 answers 404. The 404 error page is fetched from the origin at `/404.html` without going through the viewer function, so the root `404.html` serves every site.
- Lifecycle rule: expire objects under `previews/` 30 days after creation.
- Roles follow the pattern in `tamanu/artifacts/github.ts`, with trust on `ghaOidc` from `coreRef`, `StringEquals` on `aud` and `sub`.
  - Object actions (`GetObject`, `PutObject`, `DeleteObject`) apply to `arn:aws:s3:::bes-bliti-web/<prefix>*`.
  - `s3:ListBucket` on the bucket, with an `s3:prefix` condition scoped to the role's prefix.
  - `cloudfront:CreateInvalidation` and `GetInvalidation` on the distribution ARN.
- Tags: PascalCase keys, kebab-case values, folded with the core's `tags`.
- Add `bliti/` to the layout list in `docs/dev/pulumi-organisation.md`.

## Hand-offs to bliti/H4

- The `production` environment's deployment rules allow only `main` and tags.
- Every file with a compressible extension is uploaded with all three variant keys, carrying the original `Content-Type`. Where a variant wouldn't help, its key holds the plain bytes with no `Content-Encoding`. Files outside the extension list (images, fonts, etc.) need no variants.
- Preview deploys upload every object, so lifecycle expiry restarts for the whole preview. A `pull_request` `closed` job deletes `previews/pr-<n>/`.
- Deploys invalidate the paths they changed. The bucket, distribution id and role ARNs come from the stack outputs.

## Steps

- [x] Extend `BucketWebsite` with extra names; dedupe validation records in `ValidCertificate`
- [x] Scaffold `pulumi/bliti/` (Pulumi.yaml, package.json, src/index.ts, src/config.ts)
- [x] Request and response functions, with unit tests for host mapping, page paths, trailing-slash redirect and encoding choice
- [x] Bucket, lifecycle rule and distribution
- [x] Deploy roles and outputs
- [x] `npm run build` in `pulumi/policies`, then `pulumi preview --policy-pack` against the new stack
- [x] Update `docs/dev/pulumi-organisation.md`

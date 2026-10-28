# Bliti web app hosting: test cases

## Request function (unit)

- [x] `iti.tamanu.app/` is served from `prod/index.html` (verifies spec: BLWEB)
- [x] `iti.tamanu.app/provision` is served from `prod/provision.html`, and `/docs/assemble` from `prod/docs/assemble.html` (verifies spec: BLWEB)
- [x] `iti.tamanu.app/provision/?x=1` redirects permanently to `/provision?x=1` (verifies spec: BLWEB)
- [x] `iti.tamanu.app/provision` with `Accept-Encoding: br` is served from `prod/provision.html.br` (verifies spec: BLWEB)
- [x] `iti.tamanu.app/assets/app.css` is served from `prod/assets/app.css` when no coding is acceptable (verifies spec: BLWEB)
- [x] `pr-42.iti.tamanu.app/provision` is served from `previews/pr-42/provision.html` (verifies spec: BLWEB)
- [x] `foo.iti.tamanu.app` and `pr-abc.iti.tamanu.app` answer 404 (verifies spec: BLWEB)
- [x] `Accept-Encoding: gzip, br, zstd` picks `.zst`; `gzip, br` picks `.br`; `gzip` picks `.gz` (verifies spec: BLWEB)
- [x] `Accept-Encoding: zstd;q=0, br` picks `.br` (verifies spec: BLWEB)
- [x] A non-compressible path such as `.png` is never rewritten to a variant (verifies spec: BLWEB)
- [x] Host matching ignores case and a port; the CloudFront domain and `pr-01`, `pr-`, `a.pr-1` hosts answer 404 (verifies spec: BLWEB)
- [x] `*` in `Accept-Encoding` accepts every coding not named, and several `Accept-Encoding` headers are read together (verifies spec: BLWEB)
- [x] Every response carries `Vary: Accept-Encoding`, merged with an existing `Vary` (verifies spec: BLWEB)

## Deployed (manual)

- [ ] A mistyped page such as `/provison` answers 404, not the content of `index.html` (verifies spec: BLWEB)
- [ ] `http://iti.tamanu.app` redirects to HTTPS; certificate covers the apex and `pr-1.iti.tamanu.app` (verifies spec: BLWEB)
- [ ] A missing asset answers 404, not 403 (verifies spec: BLWEB)
- [ ] `curl -H 'Accept-Encoding: zstd'` on a JS asset returns `Content-Encoding: zstd`, the JS content type and `Vary: Accept-Encoding` (verifies spec: BLWEB)
- [ ] A sub-1 kB JS asset requested with `Accept-Encoding: br` returns the plain bytes with no `Content-Encoding` and the JS content type (verifies spec: BLWEB)
- [ ] The preview role can put and delete under `previews/`, and is denied putting under `prod/` (verifies spec: BLWEB)
- [ ] The prod role can put and delete under `prod/`, and is denied putting under `previews/` (verifies spec: BLWEB)
- [ ] Both roles can create an invalidation on the distribution (verifies spec: BLWEB)
- [ ] A token from a non-production environment, or a push to a non-main branch, cannot assume either role (verifies spec: BLWEB)
- [ ] The lifecycle rule on `previews/` shows a 30-day expiry (verifies spec: BLWEB)
- [x] `pulumi preview` passes the `bes-guardrails` policy pack
- [ ] The certificate validation needs only one record for the apex and the wildcard, and `pulumi up` creates it without a conflict
- [ ] A trailing-slash redirect keeps percent-encoded query values intact

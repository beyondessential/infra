# Bliti web app hosting: test cases

## Request function (unit)

- [ ] `iti.tamanu.app/` is served from `prod/index.html` (verifies spec: BLWEB)
- [ ] `iti.tamanu.app/provision` is served from `prod/provision.html`, and `/docs/assemble` from `prod/docs/assemble.html` (verifies spec: BLWEB)
- [ ] `iti.tamanu.app/provision/?x=1` redirects permanently to `/provision?x=1` (verifies spec: BLWEB)
- [ ] `iti.tamanu.app/provision` with `Accept-Encoding: br` is served from `prod/provision.html.br` (verifies spec: BLWEB)
- [ ] A mistyped page such as `/provison` answers 404, not the content of `index.html` (verifies spec: BLWEB)
- [ ] `iti.tamanu.app/assets/app.css` is served from `prod/assets/app.css` when no coding is acceptable (verifies spec: BLWEB)
- [ ] `pr-42.iti.tamanu.app/provision` is served from `previews/pr-42/provision.html` (verifies spec: BLWEB)
- [ ] `foo.iti.tamanu.app` and `pr-abc.iti.tamanu.app` answer 404 (verifies spec: BLWEB)
- [ ] `Accept-Encoding: gzip, br, zstd` picks `.zst`; `gzip, br` picks `.br`; `gzip` picks `.gz` (verifies spec: BLWEB)
- [ ] `Accept-Encoding: zstd;q=0, br` picks `.br` (verifies spec: BLWEB)
- [ ] A non-compressible path such as `.png` is never rewritten to a variant (verifies spec: BLWEB)

## Deployed (manual)

- [ ] `http://iti.tamanu.app` redirects to HTTPS; certificate covers the apex and `pr-1.iti.tamanu.app` (verifies spec: BLWEB)
- [ ] A missing asset answers 404, not 403 (verifies spec: BLWEB)
- [ ] `curl -H 'Accept-Encoding: zstd'` on a JS asset returns `Content-Encoding: zstd`, the JS content type and `Vary: Accept-Encoding` (verifies spec: BLWEB)
- [ ] A sub-1 kB JS asset requested with `Accept-Encoding: br` returns the plain bytes with no `Content-Encoding` and the JS content type (verifies spec: BLWEB)
- [ ] The preview role can put and delete under `previews/`, and is denied putting under `prod/` (verifies spec: BLWEB)
- [ ] The prod role can put and delete under `prod/`, and is denied putting under `previews/` (verifies spec: BLWEB)
- [ ] Both roles can create an invalidation on the distribution (verifies spec: BLWEB)
- [ ] A token from a non-production environment, or a push to a non-main branch, cannot assume either role (verifies spec: BLWEB)
- [ ] The lifecycle rule on `previews/` shows a 30-day expiry (verifies spec: BLWEB)
- [ ] `pulumi preview` passes the `bes-guardrails` policy pack

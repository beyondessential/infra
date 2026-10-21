# Plan: upki on Linux servers and images

Spec: [LNXSRV](../../../docs/spec/linux/server.md#certificate-revocation-data).

The goal is to have the revocation cache and the `upki` CLI on every server, refreshed in the background.
Nothing on the box consumes the cache yet: consumers such as bestool via `rustls-upki`, or monitoring, are later cards.

## Repos and order

Three PRs, landing in this order:

1. `beyondessential/third-party-builds`: build and publish the `upki` deb to `tools.ops.tamanu.io/apt`.
2. `beyondessential/linux-images`: add `image.packages.upki` and install the package in every variant.
3. `beyondessential/infra` (this card's branch): LNXSRV spec, and the ansible baseline changes for existing servers.

## Package (third-party-builds)

- Backport Ubuntu's source package (`ubuntu/devel` on `git.launchpad.net/ubuntu/+source/upki`, currently `1.0.0~beta.3+repack-0ubuntu2`) unchanged, so the user, paths, units and AppArmor profile match the archive package on 26.10+.
- Only the `upki` binary package is needed; skip `libupki*` and `upki-mirror`.
- Ubuntu's packaging provides: `/etc/upki/config.toml` (cache `/var/cache/upki`, fetch URL `https://upki.ubuntu.com/revocation/`), the `upki` system user via sysusers, tmpfiles for the cache and state dirs, and a sandboxed `upki-fetch.service` run as `upki` from `upki-fetch.timer` (10 min after boot, then 6h after each run).
  The fetch's user and sandboxing are left as the package ships them; the only override is the `background.slice` drop-in on the ansible side.
- The BES repo is a single `stable` suite serving noble, resolute and later, so build on the oldest supported release (noble) for amd64 and arm64.
  Check that noble has a new enough rustc for the vendored crates (noble-updates carries versioned `rustc-1.xx` packages if the default is too old).
- Version as Ubuntu's version plus a `~bes` suffix.
  The origin pin of 999 makes our build win over the archive's on 26.10+ regardless of version, which is fine while we track Ubuntu's source.
- Follow the existing workflow shape (matrix of native runners, publish to the CDN, `apt-repo.yml` rebuild).

## Image (linux-images)

- Add `upki` to the common `PACKAGES` list in `image/packages.sh`, so metal, cloud and pi all get it.
- Make sure `upki-fetch.timer` is enabled in the built image (the chroot build may not run the package's preset).
- No pre-fetched cache in the image: it would be stale, and the timer fetches 10 min after first boot.
- Draft requirement for `docs/spec/disk-images.md` under `## Packages`:

  ```
  r[image.packages.upki]
  upki must be installed from the bes-tools repo, configured system-wide to
  fetch revocation data from `https://upki.ubuntu.com/revocation/` into
  `/var/cache/upki`, with its periodic fetch enabled.
  ```

- Cover it in `tests/test-image-structure.sh`: binary present, config present, timer enabled.

## Ansible (infra)

- [ ] Install `upki` in the baseline packages task (the bes-tools repo is already configured before it).
- [ ] Ensure `upki-fetch.timer` is enabled and started.
- [ ] Check that starting the timer on a server that has been up longer than `OnBootSec` triggers a fetch straight away; if not, start `upki-fetch.service` once after install.
- [ ] Add a drop-in for `upki-fetch.service` putting it in `background.slice`.
- [ ] Weekly upgrade of `upki` and `ca-certificates`, alongside the existing `openssh-server` weekly cron.
- [ ] `spec: LNXSRV#certificate-revocation-data` citations on the new tasks.
- [ ] Check the support pack (`docs/`) for anything describing the scheduled upgrades or background jobs, and update it.

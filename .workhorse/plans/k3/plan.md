# Plan: upki on Linux servers and images

Spec: [LNXSRV](../../../docs/spec/linux/server.md#certificate-revocation-data).

The goal is to have the revocation cache and the `upki` CLI on every server, refreshed in the background.
Nothing on the box consumes the cache yet: consumers such as bestool via `rustls-upki`, or monitoring, are later cards.

## Repos and order

Three PRs, landing in this order (the image build and the ansible install both need the deb published):

1. `beyondessential/third-party-builds`: build and publish the `upki` deb to `tools.ops.tamanu.io/apt`.
2. `beyondessential/linux-images`: add `image.packages.upki` and install the package in every variant.
3. `beyondessential/infra` (this card's branch): LNXSRV spec, and the ansible baseline changes for existing servers.

## Package (third-party-builds)

Built on the `upki` bookmark in `beyondessential/third-party-builds` (not pushed).

- Follows the repo's convention rather than rebuilding Ubuntu's source package: noble's rustc (1.75) is below upki's MSRV (1.85), and Ubuntu's source wants unversioned rustc/cargo, dh-cargo >= 24 and cargo-c.
- Upstream `v1.0.1` (Ubuntu's archive has `1.0.0~beta.3`), built with rustup on 22.04 runners for a glibc 2.35 floor, amd64 and arm64, default features (rustls), packaged as `1.0.1-bes1`.
- `upki-files/` carries Ubuntu's config, `upki-fetch.service`/`.timer`, sysusers, tmpfiles and AppArmor profile verbatim, so the package matches the archive one on 26.10+.
  Maintainer scripts are hand-written equivalents of the debhelper snippets: sysusers, tmpfiles, AppArmor load, timer enable on install, mask on remove, purge of the cache and state dirs.
- Ubuntu's patches don't apply to 1.0.1 and aren't carried; the 32-bit overflow fix is upstream.
  Ubuntu's refuse-fetch-as-root patch is not upstream: without it, `sudo upki fetch` leaves root-owned files that the AppArmor profile's `owner` rules stop the `upki` user replacing, so the timer's fetches fail until they're removed.
  Nothing we run fetches as root; porting the patch (a `geteuid` check in `upki-cli/src/bin/upki.rs`) is open.
- Depends on `systemd (>= 250)` as Ubuntu's does, which keeps it off 22.04.
- `apt-repo.yml` and `scripts/rebuild-apt-repo.sh` pick up `upki/`; the 24.04 and 26.04 smoke tests install it and check the user, cache ownership and timer.
- Verified locally: builds, and in a 24.04 container installs (user created, timer enabled), removes (timer masked) and purges cleanly.

## Image (linux-images)

Built on the `upki` bookmark in `beyondessential/linux-images` (not pushed).

- `r[image.packages.upki]`: pre-installed from the bes-tools repo, with its periodic refresh enabled.
- Installed in `image/scripts/setup-bes-tools.sh` alongside bestool (the common `PACKAGES` list installs before the bes-tools repo exists), and pinned to 999 there like bestool.
- The package's postinst enables `upki-fetch.timer` offline in the chroot; no pre-fetched cache in the image.
- `tests/test-image-structure.sh` checks the binary and the enabled timer.

## Ansible (infra)

- [x] Install `upki` in the baseline (`roles/baseline/tasks/upki.yml`, run after the QoS slices exist).
- [x] Ensure `upki-fetch.timer` is enabled and started.
- [x] Add a drop-in for `upki-fetch.service` putting it in `background.slice`.
- [x] Weekly upgrade of `upki` and `ca-certificates`, alongside the existing `openssh-server` weekly cron.
- [x] `spec: LNXSRV#…` citations on the new tasks.
- [x] Check the support pack (`docs/`) for anything describing the scheduled upgrades or background jobs: nothing to update.

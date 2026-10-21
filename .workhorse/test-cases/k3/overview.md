# Test cases: upki on Linux servers and images

## Package

- [x] The deb installs on 24.04: `upki` user created, `upki-fetch.timer` enabled; remove masks the timer; purge removes `/var/cache/upki` and `/var/lib/upki` (local container run)
- [x] `upki fetch` run as root refuses with a pointer to `upki-fetch.service`, and runs as a normal user (local build with the ported patch)
- [x] The apt-repo smoke tests on 24.04 and 26.04 pass once the deb is published: `upki --version`, user, `/var/cache/upki/revocation` owned by `upki`, timer enabled and active
- [ ] On a server with AppArmor enforcing, `upki-fetch.service` completes a fetch with no AppArmor denials in the journal, and `/var/cache/upki/revocation` fills

## Image

- [x] The built image has `/usr/bin/upki` and `upki-fetch.timer` enabled (`test-image-structure.sh`; verifies spec: LNXSRV)
- [ ] A freshly booted image fetches revocation data on its own within the timer's boot delay, and a non-root user can run `upki` against the cache

## Ansible

- [ ] A playbook run on a server without upki installs it and starts `upki-fetch.timer` (verifies spec: LNXSRV)
- [ ] `systemctl show upki-fetch.service -p Slice` reports `background.slice` after a playbook run (verifies spec: LNXSRV)
- [ ] `/etc/cron.weekly/apt-upgrade-upki` and `/etc/cron.weekly/apt-upgrade-ca-certificates` exist and upgrade their package when run (verifies spec: LNXSRV)
- [ ] A second playbook run reports no changes for the upki tasks

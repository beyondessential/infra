# H4: kernel hardening and confinement

## Decisions

- Curated sysctl, module and boot-parameter set, not a benchmark wholesale.
  Every value is set explicitly, even where Ubuntu already sets it.
- A switch only for the risky items (lockdown, PostgreSQL sandbox, Munin sandbox, container hardening), all default on.
  Everything else is always on.
- Caddy and the bestool units already run with tuned sandboxing in their own units, so they're out of scope.
  Kopia no longer runs as its own unit (bestool manages backups).
- Boot parameters are written by the playbooks and take effect whenever the server next reboots.
  No reboot is forced and no pending-reboot flag is set.
- SysRq stays at Ubuntu's 176 so on-call keeps the serial-console recovery path.
- Read-only container root filesystems go on their own card.

## Verify on a test server before rollout

- [ ] The bes-tools podman build is built with AppArmor support, so containers get `containers-default`. If it isn't, file it on the third-party-builds side.
- [ ] Under `lockdown=integrity`, the Elastic Agent (Elastic Defend) still runs and reports.
- [ ] The Tamanu frontend, API, patient portal and mSupply containers start with all capabilities dropped except `NET_BIND_SERVICE`, and with no-new-privileges set. Check what the images write at runtime, and which user they run as.
- [ ] PostgreSQL 18 still uses io_uring with `io_uring_disabled=1` and `io_uring_group` set to postgres.
- [ ] munin-node plugins still report under the sandbox, particularly the PostgreSQL plugins over the socket and any plugins configured with `user root`.
- [ ] apport doesn't put `fs.suid_dumpable` back to 2. If it does, disable apport or keep it from overriding the value.

## Build steps

- [ ] `baseline`: sysctl file for the kernel-parameters table, applied at once.
- [ ] `baseline`: extend the modprobe blocklist (rebuild initramfs and unload modules). Keep the known-vulnerable modules in their existing file or merge them, and retarget the `spec:` citations to `#kernel-modules`.
- [ ] `baseline`: boot parameters through a GRUB drop-in (`/etc/default/grub.d/`) followed by `update-grub`, and through `cmdline.txt` on Pi hosts. Keep the existing parameters. `lockdown` depends on `kernel_lockdown_enabled`, and is removed when that is false.
- [ ] `baseline`: AppArmor installed, enabled and its service enabled.
- [ ] `postgres`: sandbox drop-in in `postgresql@.service.d/`, removed when `postgres_sandbox_enabled` is false.
- [ ] `munin`: sandbox drop-in for munin-node, removed when `munin_sandbox_enabled` is false.
- [ ] Tamanu and mSupply quadlets: `DropCapability=all`, `AddCapability=NET_BIND_SERVICE` and `NoNewPrivileges=true`, depending on `container_hardening_enabled`.
- [ ] `variables.schema.json` and the catalogue entries for the four new variables. Run `uv run python catalogue.py tags` if any tags change.
- [ ] `check-linux-lpe-2026.yml` and the kernel modules SOP: the play checks every module in the table, so update the SOP verdict table, since only some modules are known vulnerable.

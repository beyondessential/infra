# H4: kernel hardening and confinement

Builds the Kernel hardening and Confinement sections of LNXSRV in the Ansible roles, along with the variables, catalogue and support docs that go with them.

## Decisions

- Curated sysctl, module and boot-parameter set, not a benchmark wholesale.
  Every value is set explicitly, even where Ubuntu already sets it.
- A switch only for the risky items, all default on: `kernel_lockdown_enabled`, `container_hardening_enabled`, and the `sandboxes` list (`[postgres, munin]`).
  Everything else is always on.
- Caddy and the bestool units already run with tuned sandboxing in their own units, so they're out of scope.
  Kopia no longer runs as its own unit (bestool manages backups).
- Boot parameters are written by the playbooks and take effect whenever the server next reboots.
  No reboot is forced and no pending-reboot flag is set.
- SysRq stays at Ubuntu's 176 so on-call keeps the serial-console recovery path.
- Read-only container root filesystems are on #N4.

## Tech notes

- **Kernel parameters** go in one file, `/etc/sysctl.d/99-bes-hardening.conf`, so they sort after Ubuntu's `10-*.conf` and the systemd defaults.
  The per-interface keys (redirects, source routing, `rp_filter`) are written as `net.ipv4.conf.*.<key>` globs, not just as `all` and `default`.
  `systemd-sysctl` re-runs from udev for every new interface and applies the globs to it, which covers podman and Tailscale interfaces created after boot.
  The values are applied by restarting `systemd-sysctl`, since the `ansible.posix.sysctl` module can't express globs.
- **io_uring** is split by role ownership.
  The baseline sets `kernel.io_uring_disabled=1`.
  The postgres role sets `kernel.io_uring_group` in its own file, `/etc/sysctl.d/99-postgres-io-uring.conf`, because the `postgres` group only exists once that role has run.
  Between the two, only root can use io_uring, which is the intended state on a host without PostgreSQL.
- **Kernel modules** move into one file, `/etc/modprobe.d/bes-kernel-modules.conf`, which carries `blacklist` and `install … /bin/false` for each module.
  `cve-2026-linux-lpe.conf` is removed in the same task so the two files don't drift.
  The task file and tag are renamed from `kernel-mitigations` to `kernel-modules`, matching the spec anchor, and the catalogue tags are regenerated.
- **Boot parameters**:
  - On GRUB hosts (EC2 and the BES images other than Pi), a drop-in `/etc/default/grub.d/99-bes-hardening.cfg` appends to `GRUB_CMDLINE_LINUX_DEFAULT`. It sorts after `50-cloudimg-settings.cfg`, so cloud-image parameters are kept. A change notifies an `update-grub` handler.
  - On Pi hosts (`/boot/firmware/cmdline.txt` present, no GRUB), the parameters are merged into the single line of `cmdline.txt` token by token. On those hosts, `lockdown=integrity` is removed as a token when the switch is off.
  - The merge logic goes in a small filter or task file that both paths share, so it can be unit-tested the way `test_baseline_ssh_keys.py` tests its task.
- **Service sandboxes** are systemd drop-ins named `sandbox.conf`.
  PostgreSQL's goes next to the existing `qos.conf` in `postgresql@.service.d/`, and munin-node's in `munin-node.service.d/`.
  Each is `state: absent` when its name isn't in `sandboxes`, and notifies `Reload systemd` and the service's restart handler.
  The directives map one to one onto the spec's restrictions: `NoNewPrivileges`, `CapabilityBoundingSet`, `ProtectSystem=strict` with `ReadWritePaths`, `ProtectHome`, `PrivateTmp`, `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`, `RestrictNamespaces`, `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK`, `SystemCallArchitectures=native` and `RestrictRealtime`.
  PostgreSQL also gets `PrivateDevices`. Neither gets `MemoryDenyWriteExecute`.
- **Container hardening** uses quadlet drop-ins named `hardening.conf` that set `DropCapability=all`, `AddCapability=NET_BIND_SERVICE` and `NoNewPrivileges=true`.
  Tamanu's goes in the existing prefix directory `/etc/containers/systemd/tamanu-.container.d/` and mSupply's in `msupply.container.d/`.
  Each is absent when `container_hardening_enabled` is false.
  The drop-in only takes effect on the container's next restart, through the roles' existing restart flow.
- **PostgreSQL's sandbox runs the service as `postgres`.**
  Debian's `postgresql@.service` starts `pg_ctlcluster` as root, which drops to the `postgres` user itself and needs `CAP_SETUID` and `CAP_SETGID`.
  The drop-in sets `User=postgres` and `Group=postgres` so that an empty capability set still starts the service.
  Unconfirmed against the unit on a real server: see the checks below.
- **Restart on a sandbox change:** like tuning, the PostgreSQL sandbox restarts PostgreSQL unless the Tailscale name contains `prod`, where it prints a warning and leaves the restart.
  The munin-node sandbox restarts munin-node.
- **Variable defaults:** `kernel_lockdown_enabled` goes in `baseline/defaults`. `sandboxes` and `container_hardening_enabled` go in `common/defaults`, because postgres, munin, tamanu-single-install and msupply-install all depend on `common`.

## Verify on a test server before rollout

Use the Vagrant box (Ubuntu 24.04 cloud image) for everything except the EC2-specific items, then one staging instance.

- [ ] The bes-tools podman build is built with AppArmor support (the build workflow's `BUILDTAGS` carries `apparmor`, so only the runtime check is left): `podman info` shows AppArmor enabled, and a running container's `/proc/1/attr/current` names `containers-default`. If it isn't, create a card on the third-party-builds side and leave the podman assertion step below unticked.
- [ ] Under `lockdown=integrity`, the Elastic Agent (Elastic Defend) still runs and reports.
- [ ] The Tamanu frontend, API, patient portal and mSupply containers start and serve with the hardening drop-in in place. Check what the images write at runtime and which user they run as.
- [ ] PostgreSQL 18 still uses io_uring (`io_method = io_uring` and no fallback warning in the log) with `io_uring_disabled=1` and the group set.
- [ ] The `postgresql@.service` unit starts with `User=postgres` and no capabilities. If it needs the privileges that `pg_ctlcluster` drops with, give it `CAP_SETUID CAP_SETGID` instead and say so in LNXSRV.
- [ ] PostgreSQL starts, accepts socket connections and writes its log under the sandbox, in both the single and the split layout.
- [ ] munin-node plugins still report under the sandbox, particularly the PostgreSQL plugins over the socket and any plugins configured with `user root`. munin-node may need `CAP_KILL` to time out plugins running as another user. If it does, add "signalling the plugins it runs" to the Munin node's capabilities in LNXSRV.
- [ ] apport doesn't put `fs.suid_dumpable` back to 2 when it starts. If it does, disable apport's core handling so the value holds.
- [ ] The globbed per-interface keys hold on `podman0`, `tailscale0` and the primary interface after a reboot (`sysctl -a | rg redirects`).
- [ ] After a reboot, `/proc/cmdline` carries the boot parameters, `/sys/kernel/security/lockdown` shows `[integrity]`, and the cloud-image parameters are still there.

## Build steps

### Baseline role

- [x] Add `kernel-parameters.yml` with the `99-bes-hardening.conf` template and a `Reload sysctl` handler that restarts `systemd-sysctl`. Import it in `main.yml` with the tag `kernel-parameters` and cite `LNXSRV#kernel-parameters`.
- [x] Replace `kernel-mitigations.yml` with `kernel-modules.yml`: write `bes-kernel-modules.conf` from a list in role vars, remove `cve-2026-linux-lpe.conf`, notify `Rebuild initramfs`, and unload every listed module. Change the tag to `kernel-modules` and the citation to `LNXSRV#kernel-modules`.
- [x] Add `boot-parameters.yml`, with the GRUB drop-in path, the `cmdline.txt` path, a shared merge step and an `Update grub` handler. Add `kernel_lockdown_enabled: true` to `defaults/main.yml`. Tag `boot-parameters`, citing `LNXSRV#boot-parameters`.
- [x] Add `apparmor.yml`: install `apparmor`, enable and start `apparmor.service`, and fail with a clear message if `/sys/module/apparmor/parameters/enabled` isn't `Y`. Tag `apparmor`, citing `LNXSRV#apparmor`.

### Service and container roles

- [x] `postgres`: add the io_uring group sysctl file and apply it, citing `LNXSRV#kernel-parameters`.
- [x] `postgres`: add the `sandbox.conf` drop-in, present or absent from `sandboxes`, citing `LNXSRV#service-sandboxes`.
- [x] `munin`: add the munin-node `sandbox.conf` drop-in the same way, notifying `Restart munin-node`.
- [x] `common/defaults`: add `sandboxes: [postgres, munin]` and `container_hardening_enabled: true`.
- [x] `tamanu-single-install/tasks/quadlets.yml`: add the `hardening.conf` drop-in in `tamanu-.container.d/`, citing `LNXSRV#containers`.
- [x] `msupply-install/tasks/quadlet.yml`: add the same drop-in in `msupply.container.d/`.
- [x] `podman`: assert that `podman info` reports AppArmor enabled, citing `LNXSRV#apparmor`. The bes-tools podman workflow builds with the `apparmor` build tag and `libapparmor-dev`, so the build supports it.

### Catalogue, checks and tests

- [x] `variables.schema.json`: add `kernel_lockdown_enabled` and `container_hardening_enabled` as booleans defaulting to true, and `sandboxes` as an array of unique values from the enum `postgres`, `munin`, defaulting to both. All cite `LNXSRV#inventory-variables`.
- [x] Run `uv run python catalogue.py tags` for the new and renamed baseline tags.
- [x] `check-linux-lpe-2026.yml`: check every module in the blocklist, read from the baseline role's vars. Modules outside the CVE groups are reported with their group instead of a CVE.
- [x] Unit test the boot-parameter merge (`ansible/tests/test_baseline_boot_parameters.py`), covering: parameters appended to an existing line, an existing parameter kept, `lockdown` removed when the switch is off, and the merge staying idempotent.
- [x] `uv run ansible-lint`, and `--syntax-check` on `base-install.yml`, `tamanu-install.yml` and `tamanu-upgrade.yml`.

### Support docs

- [x] `docs/sops/linux-check-kernel-modules.md`: the verdict table covers modules that are unused rather than vulnerable, and the line about the block living in `cve-2026-linux-lpe.conf` and being temporary goes.
- [x] `docs/reference/linux-paths-and-units.md`: replace the `cve-2026-linux-lpe.conf` row, and add rows for `99-bes-hardening.conf`, `99-postgres-io-uring.conf`, the GRUB drop-in, and the `sandbox.conf` and `hardening.conf` drop-ins.
- [x] Add a short entry to the support pack, following `curate-support-docs`, for turning off a switch on a server where the hardening breaks something: which variable, then which tag to re-run, and that `kernel_lockdown_enabled` only takes effect after a reboot.

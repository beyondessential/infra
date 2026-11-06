# Microsoft Defender for Endpoint on Linux servers

The spec is the endpoint security agent section of LNXSRV (`docs/spec/linux/server.md#endpoint-security-agent`).

## Decisions

- Onboarding is direct, through Ansible: the role adds the Microsoft repository, installs `mdatp` and places `mdatp_onboard.json`.
  No Azure Arc and no Defender for Cloud AWS connector.
  Licensing (Defender for Servers direct onboarding, or another server licence) is outside the repo.
- One agent per server, chosen by `endpoint_security_agent`, because Defender and Elastic Endpoint both use fanotify and Microsoft does not support them side by side.
- `elastic_agent_enabled: true` forces Elastic, so existing inventories behave as before with no edits.
  It is transitional: once every inventory that sets it has `endpoint_security_agent: elastic` instead, drop the variable from the role, the catalogue and LNXSRV.
- Ansible owns enforcement level, exclusions and the `GROUP` tag in `mdatp_managed.json`; the Defender portal owns every other setting.
  Microsoft advises one channel per setting.
- Real-time by default, with `/var/lib/postgresql` excluded by path and the PostgreSQL server binaries excluded by process; `defender_passive` drops to passive.
- `mdatp` joins the weekly upgrade list, since Microsoft expires old agent versions.
- Kubernetes nodes are out of this card: they need Defender for Containers (Arc-enabled Kubernetes and a sensor DaemonSet), a different product with per-vCore pricing, evaluated on card P4.
- PostgreSQL is the only exclusion.

## Build

- [x] Restructure the `elastic-agent` role into an endpoint security role that resolves the chosen agent (override, then selector), removes the other agent first, then installs the chosen one
- [x] Defender install: Microsoft key under `/etc/apt/keyrings`, `packages.microsoft.com/ubuntu/<version>/prod` source with `signed-by`, pin 900, `mdatp` package
- [x] Onboarding: write `defender_onboarding` to `/etc/opt/microsoft/mdatp/mdatp_onboard.json` (mode 0600, `no_log`)
- [x] Managed config: template `mdatp_managed.json` with enforcement level, path and process exclusions, optional `GROUP` tag
- [x] Removal: stop and purge `mdatp`, remove `/etc/opt/microsoft/mdatp`
- [x] Weekly `mdatp` upgrade alongside the existing scheduled upgrades
- [x] Tags: keep `elastic`, add `defender`, and an umbrella tag for the whole agent selection; run `uv run python catalogue.py tags`
- [x] `ansible/variables.schema.json`: add `endpoint_security_agent` (enum), `defender_onboarding` (secret), `defender_passive`, `defender_group_tag`; update the description of `elastic_agent_enabled`
- [x] Support pack: `docs/reference/linux-roles.md`, `docs/reference/linux-credentials.md` (Defender onboarding file row), `docs/reference/linux-inventory.md` (secret variables list)
- [x] `// spec:` citations on the role tasks
- [ ] Check Defender on a test server with the kernel hardening of card H4 applied (see below)

The role is `endpoint-security` (renamed from `elastic-agent`), split into remove and install task files per agent.
Removal of both non-chosen agents runs under either the `elastic` or `defender` tag, ahead of any install, so a partial run cannot leave two agents.
The `mdatp` pin is on the package alone (`Package: mdatp`), because the Microsoft repository also carries packages Ubuntu ships.

Both removal and install files are keyed on the resolved agent alone, so the resolver's check of the enrolment token and the onboarding file is the only one.
PostgreSQL's server binaries are excluded by full path, found at run time: Defender ignores a bare process name in an exclusion of global scope, which is the scope an exclusion takes when it names none.
The managed configuration is not notified to the agent, because Defender reads all of what Ansible writes there without a restart; only the onboarding file needs one.
An agent's secret counts as present only when it is non-empty, since a cleared inventory secret arrives as an empty string and would otherwise install an agent that is never enrolled or onboarded.
Each agent's apt source, pin and key are removed with the agent, the Elastic side included, as the spec scopes both repositories to the servers running that agent.
Everything the Microsoft repository carries other than `mdatp` is pinned below the Ubuntu archive, so no Microsoft build can replace an Ubuntu package by version. Checked in a Ubuntu 24.04 container: `mdatp` stays at 900 and the rest become uninstallable.

## Kernel hardening compatibility

Card H4 adds kernel parameters, a wider module blocklist, `debugfs=off`, `lockdown=integrity` and AppArmor to the baseline.
By kernel semantics nothing there should stop Defender:

- Defender has no kernel module. Its event sensor is eBPF, and it falls back to netlink, which loses file and socket events, where eBPF cannot load.
- Integrity lockdown blocks only BPF writes to user memory among the BPF and tracing operations. Kprobes, BPF kernel reads, perf and tracefs are restricted only under confidentiality lockdown.
- `debugfs=off` leaves tracefs, which is a filesystem of its own at `/sys/kernel/tracing`.
- `unprivileged_bpf_disabled`, `perf_event_paranoid` and `ptrace_scope` limit callers without capabilities. Defender's sensor runs as root.
- None of the blocked modules are netfilter modules, which device isolation needs.

`kptr_restrict=2` is the one setting that could matter: it hides kernel symbol addresses from root too, which breaks a sensor that resolves addresses itself instead of attaching by name.
`io_uring_disabled=1` matters only if a Defender component that does not run as root uses io_uring.

Confirm empirically: `mdatp health` reports healthy, with `supplementary_events_subsystem` as `ebpf` rather than a fallback. A server can be healthy while it has fallen back.
If a hardening setting has to be relaxed for Defender, settle with H4 whether it becomes a per-server switch.

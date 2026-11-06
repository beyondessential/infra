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

- [ ] Restructure the `elastic-agent` role into an endpoint security role that resolves the chosen agent (override, then selector), removes the other agent first, then installs the chosen one
- [ ] Defender install: Microsoft key under `/etc/apt/keyrings`, `packages.microsoft.com/ubuntu/<version>/prod` source with `signed-by`, pin 900, `mdatp` package
- [ ] Onboarding: write `defender_onboarding` to `/etc/opt/microsoft/mdatp/mdatp_onboard.json` (mode 0600, `no_log`)
- [ ] Managed config: template `mdatp_managed.json` with enforcement level, path and process exclusions, optional `GROUP` tag
- [ ] Removal: stop and purge `mdatp`, remove `/etc/opt/microsoft/mdatp`
- [ ] Weekly `mdatp` upgrade alongside the existing scheduled upgrades
- [ ] Tags: keep `elastic`, add `defender`, and an umbrella tag for the whole agent selection; run `uv run python catalogue.py tags`
- [ ] `ansible/variables.schema.json`: add `endpoint_security_agent` (enum), `defender_onboarding` (secret), `defender_passive`, `defender_group_tag`; update the description of `elastic_agent_enabled`
- [ ] Support pack: `docs/reference/linux-roles.md`, `docs/reference/linux-credentials.md` (Defender onboarding file row), `docs/reference/linux-inventory.md` (secret variables list)
- [ ] `// spec:` citations on the role tasks
